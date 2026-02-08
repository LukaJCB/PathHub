import { mlsMessageDecoder, processPrivateMessage, MlsMessage, wireformats, decode, MlsContext } from "ts-mls"
import { MessageClient } from "./http/messageClient"
import { FollowRequests, processAllowFollow, receiveFollowRequest } from "./followRequest"
import {
  FollowerManifest,
  Manifest,
  PostManifest,
  PostManifestPage,
  PostMeta,
  StorageIdentifier,
  Entity,
  FollowerGroupState,
  updateEntity,
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
  manifest: Entity<Manifest>,
  postManifest: Entity<PostManifest>,
  postManifestPage: Entity<PostManifestPage>,
  ownGroupState: Entity<FollowerGroupState>,
  followRequests: Entity<FollowRequests>,
  userId: string,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
  mls: MlsContext,
): Promise<
  [
    Entity<FollowRequests>,
    Entity<Manifest>,
    Entity<PostManifest>,
    Entity<PostManifestPage>,
    Entity<FollowerManifest> | undefined,
    Entity<FollowerGroupState> | undefined,
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
        masterKey,
        currentFollowRequests,
        remoteStore,
        mls,
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
  mlsGroup: Entity<FollowerGroupState>,
  sender: string,
  userId: string,
  postManifest: Entity<PostManifest>,
  postManifestPage: Entity<PostManifestPage>,
  manifest: Entity<Manifest>,
  masterKey: Uint8Array,
  followRequests: Entity<FollowRequests>,
  remoteStore: RemoteStore,
  mls: MlsContext,
): Promise<
  [
    Entity<FollowRequests>,
    Entity<Manifest>,
    Entity<FollowerManifest> | undefined,
    Entity<FollowerGroupState> | undefined, //own group state
    Entity<PostManifestPage>,
    Entity<PostManifest>,
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
        remoteStore,
        mls,
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
      const groupState = followerGroupState!.groupState
      //todo only allow commits from group owner
      const result = await processPrivateMessage({
        state: groupState,
        privateMessage: msg.privateMessage,
        context: mls,
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
              mlsGroup.groupState,
              mls,
              postManifestPage,
              pageId,
              postManifest,
              manifest,
              masterKey,
            )

            return [followRequests, newManifest, undefined, undefined, newPage, newPostManifest]
          } else {
            const interactions = followerGroupState!.cachedInteractions.get(message.interaction.postId) ?? []

            const newInteractions = [...interactions, message.interaction]

            const newMap = followerGroupState?.cachedInteractions.set(message.interaction.postId, newInteractions)

            const newFollowerGroupState = {
              groupState: result.newState,
              cachedInteractions: newMap!,
            }

            await encryptAndStoreWithPostSecret(
              masterKey,
              remoteStore,
              encodeFollowerGroupState(newFollowerGroupState),
              groupStateId,
              followerGroupState!.version,
            )
          }
        }
      } else if (result.kind === "newState") {
        const newFollowerGroupState = {
          ...followerGroupState!,
          groupState: result.newState,
          version: followerGroupState!.version + 1n,
        }

        await encryptAndStoreWithPostSecret(
          masterKey,
          remoteStore,
          encodeFollowerGroupState(newFollowerGroupState),
          groupStateId,
          followerGroupState!.version,
        )
        //todo flush cachedInteractions whenever a new commit arrives
      }

      const [_newFollowerGroupStatePayload, newFollowerGroupState] = updateEntity(
        mlsGroup,
        { ...mlsGroup, groupState: result.newState },
        encodeFollowerGroupState,
      )

      return [followRequests, manifest, undefined, newFollowerGroupState, postManifestPage, postManifest]
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
