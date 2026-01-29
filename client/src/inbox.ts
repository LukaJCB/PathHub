import {
  CiphersuiteImpl,
  ClientState,
  clientStateDecoder,
  mlsMessageDecoder,
  clientStateEncoder,
  processPrivateMessage,
  MlsMessage,
  wireformats,
  decode,
  unsafeTestingAuthenticationService,
  encode,
} from "ts-mls"
import { MessageClient } from "./http/messageClient"
import { FollowRequests, processAllowFollow, receiveFollowRequest } from "./followRequest"
import {
  FollowerManifest,
  Manifest,
  PostManifest,
  PostManifestPage,
  PostMeta,
  StorageIdentifier,
  Versioned,
} from "./manifest"
import {
  RemoteStore,
  retrieveAndDecryptGroupState,
  retrieveAndDecryptPostManifestPage,
  uint8ToBase64Url,
} from "./remoteStore"
import { decodeMessage, decodeMessagePublic } from "./codec/decode"
import { encryptAndStoreWithPostSecret } from "./createPost"
import { encodeFollowerGroupState } from "./codec/encode"
import { interactOwnPost } from "./postInteraction"

export async function processIncoming(
  client: MessageClient,
  manifest: Versioned<Manifest>,
  postManifest: Versioned<PostManifest>,
  postManifestPage: Versioned<PostManifestPage>,
  manifestId: Uint8Array,
  ownGroupState: Versioned<ClientState>,
  followRequests: Versioned<FollowRequests>,
  userId: string,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<
  [
    Versioned<FollowRequests>,
    Versioned<Manifest>,
    Versioned<PostManifest>,
    Versioned<PostManifestPage>,
    Versioned<FollowerManifest> | undefined,
    Versioned<ClientState> | undefined,
  ]
> {
  const messages = await client.receiveMessages()

  console.log(`Fetched ${messages.length} message, processing...`)
  //need to apply this to more things that will get updated...
  let currentFollowRequests = followRequests
  let currentManifest = manifest
  let currentPage = postManifestPage
  let currentPostManifest = postManifest
  let currentFollowerManifest = undefined
  let currentClientState = undefined
  for (const m of messages) {
    const mp = decodeMessagePublic(m.payload)

    if (mp.kind === "GroupMessage") {
      const message = decode(mlsMessageDecoder, mp.mlsMessage)!
      //todo we should probably
      const result = await processMlsMessage(
        message,
        ownGroupState,
        m.sender,
        userId,
        postManifest,
        postManifestPage,
        currentManifest,
        manifestId,
        masterKey,
        currentFollowRequests,
        remoteStore,
        impl,
      )

      currentFollowRequests = result[0]
      currentManifest = result[1]
      currentFollowerManifest = result[2] ?? currentFollowerManifest
      currentPage = result[4]
      currentPostManifest = result[5]
      currentClientState = result[3] ?? currentClientState
    } else {
      const newFollowRequests = await receiveFollowRequest(
        mp.keyPackage,
        m.sender,
        currentFollowRequests,
        manifest.followRequests,
        masterKey,
        remoteStore,
      )

      currentFollowRequests = newFollowRequests
    }
  }

  if (messages.length > 0) {
    await client.ackMessages({ messageIds: messages.map((m) => m.id) })
  }

  console.log(`Finished processing ${messages.length} messages`)

  return [
    currentFollowRequests,
    currentManifest,
    currentPostManifest,
    currentPage,
    currentFollowerManifest,
    currentClientState,
  ]
}

export async function processMlsMessage(
  msg: MlsMessage,
  mlsGroup: Versioned<ClientState>,
  sender: string,
  userId: string,
  postManifest: Versioned<PostManifest>,
  postManifestPage: Versioned<PostManifestPage>,
  manifest: Versioned<Manifest>,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  followRequests: Versioned<FollowRequests>,
  remoteStore: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<
  [
    Versioned<FollowRequests>,
    Versioned<Manifest>,
    Versioned<FollowerManifest> | undefined,
    Versioned<ClientState> | undefined,
    Versioned<PostManifestPage>,
    Versioned<PostManifest>,
  ]
> {
  switch (msg.wireformat) {
    case wireformats.mls_welcome: {
      const result = await processAllowFollow(
        sender,
        msg.welcome,
        followRequests,
        masterKey,
        manifest,
        manifestId,
        remoteStore,
        impl,
      )
      return [result[0], result[1], result[2], undefined, postManifestPage, postManifest]
    }
    case wireformats.mls_private_message: {
      const groupStateId = manifest.groupStates.get(uint8ToBase64Url(msg.privateMessage.groupId))!
      const followerGroupState = await retrieveAndDecryptGroupState(
        remoteStore,
        uint8ToBase64Url(groupStateId),
        masterKey,
      )
      const groupState = decode(clientStateDecoder, followerGroupState!.groupState)!
      //todo only allow commits from group owner
      const result = await processPrivateMessage({
        state: groupState,
        privateMessage: msg.privateMessage,
        context: { cipherSuite: impl, authService: unsafeTestingAuthenticationService },
      })

      if (result.kind === "applicationMessage") {
        const message = decodeMessage(result.message)
        if (message.kind === "Interaction") {
          if (userId === message.posterId) {
            const { meta, pageId } = (await findPostMeta(
              postManifestPage,
              postManifest,
              message.interaction.postId,
              remoteStore,
            ))!

            const {
              newManifest: [newManifest, newPostManifest, newPage],
            } = await interactOwnPost(
              meta,
              remoteStore,
              message.interaction,
              mlsGroup,
              impl,
              postManifestPage,
              pageId,
              postManifest,
              manifest,
              manifestId,
              masterKey,
            )

            return [
              followRequests,
              newManifest,
              undefined,
              { ...result.newState, version: followerGroupState!.version + 1n },
              newPage,
              newPostManifest,
            ]
          } else {
            const interactions = followerGroupState!.cachedInteractions.get(message.interaction.postId) ?? []

            const newInteractions = [...interactions, message.interaction]

            const newMap = followerGroupState?.cachedInteractions.set(message.interaction.postId, newInteractions)

            const newFollowerGroupState = {
              groupState: encode(clientStateEncoder, result.newState),
              cachedInteractions: newMap!,
            }

            await encryptAndStoreWithPostSecret(
              masterKey,
              remoteStore,
              encodeFollowerGroupState(newFollowerGroupState),
              groupStateId,
            )
          }
        }
      } else if (result.kind === "newState") {
        const newFollowerGroupState = {
          ...followerGroupState!,
          groupState: encode(clientStateEncoder, result.newState),
          version: followerGroupState!.version + 1n,
        }

        await encryptAndStoreWithPostSecret(
          masterKey,
          remoteStore,
          encodeFollowerGroupState(newFollowerGroupState),
          groupStateId,
        )
        //todo flush cachedInteractions whenever a new commit arrives
      }

      return [
        followRequests,
        manifest,
        undefined,
        { ...result.newState, version: followerGroupState!.version + 1n },
        postManifestPage,
        postManifest,
      ]
    }
    default: {
      //todo
      return [followRequests, manifest, undefined, undefined, postManifestPage, postManifest]
    }
  }
}

export async function findPostMeta(
  page: PostManifestPage,
  postManifest: PostManifest,
  postId: string,
  rs: RemoteStore,
): Promise<{ meta: PostMeta; pageId: StorageIdentifier } | undefined> {
  const inPage = page.posts.find((p) => p.main[0] === postId)
  if (inPage) {
    return { meta: inPage, pageId: postManifest.currentPage }
  }

  for (const p of postManifest.pages) {
    const page = await retrieveAndDecryptPostManifestPage(rs, p.page)
    const found = page?.posts.find((p) => p.main[0] === postId)
    if (found) return { meta: found, pageId: p.page }
  }
}
