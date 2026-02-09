import { MessagePublic } from "./message"
import { MessageClient } from "./http/messageClient"
import {
  CiphersuiteImpl,
  ClientState,
  createCommit,
  generateKeyPackageWithKey,
  KeyPackage,
  Proposal,
  Credential,
  joinGroupWithExtensions,
  MlsMessage,
  decode,
  defaultProposalTypes,
  encode,
  defaultCredentialTypes,
  makeCustomExtension,
  mlsMessageEncoder,
  GroupInfoExtension,
  MlsContext,
  getGroupMembers,
  getOwnLeafNode,
} from "ts-mls"
import { Welcome } from "ts-mls"
import { deriveGroupIdFromUserId, recipientsFromMlsState } from "./mlsInteractions"
import {
  FollowerGroupState,
  FollowerManifest,
  Manifest,
  PostManifest,
  PostManifestPage,
  Entity,
  updateEntity,
  newEntity,
} from "./manifest"
import { RemoteStore, uint8ToBase64Url } from "./remoteStore"
import {
  encodeFollowerManifest,
  encodeFollowRequests,
  encodeManifest,
  encodeMessagePublic,
  encodePostManifest,
  encodePostManifestPage,
  encodePrivateKeyPackage,
  encodeFollowerGroupState,
} from "./codec/encode"
import { batchEncryptAndStoreWithSecrets, derivePostSecret, ExtraInstruction } from "./createPost"
import { decodeFollowerManifest, decodePrivateKeyPackage } from "./codec/decode"
import { SignatureKeyPair } from "./init"
import { keyPackageDecoder, keyPackageEncoder } from "ts-mls"
import { isDefaultCredential } from "ts-mls"

export interface FollowRequests {
  outgoing: { followeeId: string; keyPackage: Uint8Array; privateKeyPackage: Uint8Array }[]
  incoming: { followerId: string; keyPackage: Uint8Array }[]
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a[i]! ^ b[i]!
  }
  return result === 0
}

export function getAllFollowers(mlsGroup: ClientState): Uint8Array[] {
  const allMembers = getGroupMembers(mlsGroup)
  const ownLeafNode = getOwnLeafNode(mlsGroup)

  const result: Uint8Array[] = []
  for (const leafNode of allMembers) {
    if (!constantTimeEqual(leafNode.signaturePublicKey, ownLeafNode.signaturePublicKey)) {
      if (
        !isDefaultCredential(leafNode.credential) ||
        leafNode.credential.credentialType !== defaultCredentialTypes.basic
      )
        throw new Error("No good")
      result.push(leafNode.credential.identity)
    }
  }
  return result
}

export function getAllFollowersForNonOwner(mlsGroup: ClientState, userId: string): Uint8Array[] {
  const allMembers = getGroupMembers(mlsGroup)
  const result: Uint8Array[] = []
  for (const leafNode of allMembers) {
    if (
      !isDefaultCredential(leafNode.credential) ||
      leafNode.credential.credentialType !== defaultCredentialTypes.basic
    )
      throw new Error("No good")
    const decoded = new TextDecoder().decode(leafNode.credential.identity)
    if (decoded !== userId) result.push(leafNode.credential.identity)
  }
  return result
}

export const followerManifestExtensionType = 0xfaaa

export function getAllFollowees(manifest: Manifest): string[] {
  return [...manifest.followerManifests.keys()]
}

export async function requestFollow(
  credential: Credential,
  followeeId: string,
  signatureKeyPair: SignatureKeyPair,
  followRequests: Entity<FollowRequests>,
  masterKey: Uint8Array,
  messageClient: MessageClient,
  remoteStore: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<Entity<FollowRequests>> {
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey({
    credential,
    signatureKeyPair,
    cipherSuite: impl,
  })

  const encodedPublicPackage = encode(keyPackageEncoder, publicPackage) //todo should this be encoded as mlsMessage?

  const msg: MessagePublic = { kind: "FollowRequest", keyPackage: encodedPublicPackage }

  const [newFollowRequestsPayload, newFollowRequests] = updateEntity<FollowRequests>(
    followRequests,
    {
      incoming: followRequests.incoming,
      outgoing: [
        { followeeId, keyPackage: encodedPublicPackage, privateKeyPackage: encodePrivateKeyPackage(privatePackage) },
        ...followRequests.outgoing,
      ],
    },
    encodeFollowRequests,
    masterKey,
  )

  await Promise.all([
    batchEncryptAndStoreWithSecrets(remoteStore, [newFollowRequestsPayload]),
    messageClient.sendMessage({ payload: encodeMessagePublic(msg), recipients: [followeeId] }),
  ])

  return newFollowRequests
}

export async function receiveFollowRequest(
  keyPackage: Uint8Array,
  followerId: string,
  followRequests: Entity<FollowRequests>,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
): Promise<Entity<FollowRequests>> {
  const [newFollowRequestsPayload, newFollowRequests] = updateEntity<FollowRequests>(
    followRequests,
    {
      incoming: [{ keyPackage, followerId }, ...followRequests.incoming],
      outgoing: followRequests.outgoing,
    },
    encodeFollowRequests,
    masterKey,
  )

  await batchEncryptAndStoreWithSecrets(remoteStore, [newFollowRequestsPayload])

  return newFollowRequests
}

export async function allowFollow(
  followerId: string,
  followeeId: string,
  keyPackage: KeyPackage,
  followRequests: Entity<FollowRequests>,
  page: Entity<PostManifestPage>,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  followerGroupState: Entity<FollowerGroupState>,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
  messageClient: MessageClient,
  mls: MlsContext,
): Promise<
  [Entity<FollowRequests>, Entity<FollowerGroupState>, Entity<Manifest>, Entity<PostManifest>, Entity<PostManifestPage>]
> {
  const addProposal: Proposal = {
    proposalType: defaultProposalTypes.add,
    add: { keyPackage },
  }

  //include FollowerManifest (id of post manifest and current page) in groupInfoExtensions to send in the welcome
  const followerManifest: FollowerManifest = {
    postManifest: manifest.postManifest,
    currentPage: postManifest.currentPage,
  }
  const extension: GroupInfoExtension = makeCustomExtension({
    extensionType: followerManifestExtensionType,
    extensionData: encodeFollowerManifest(followerManifest),
  })

  const commitResult = await createCommit({
    state: followerGroupState.groupState,
    context: mls,
    extraProposals: [addProposal],
    groupInfoExtensions: [extension],
    ratchetTreeExtension: true,
  })

  const [newFollowRequestsPayload, newFollowRequests] = updateEntity<FollowRequests>(
    followRequests,
    {
      incoming: followRequests.incoming.filter((fr) => fr.followerId !== followerId),
      outgoing: followRequests.outgoing,
    },
    encodeFollowRequests,
    masterKey,
  )

  const newGroupState = commitResult.newState
  //todo there are a lot of optimizations we could do that cache the current post secret so we don't have to re-derive it everytime.
  const newSecret = await derivePostSecret(newGroupState, mls.cipherSuite)

  const [newPostManifestPayload, newPostManifest] = updateEntity<PostManifest>(
    postManifest,
    {
      ...postManifest,
      currentPage: [postManifest.currentPage[0], newSecret],
    },
    encodePostManifest,
    newSecret,
  )

  const [newManifestPayload, newManifest] = updateEntity<Manifest>(
    manifest,
    {
      ...manifest,
      postManifest: [manifest.postManifest[0], newSecret],
    },
    encodeManifest,
    masterKey,
  )

  const recipients = recipientsFromMlsState([followerId, followeeId], followerGroupState.groupState)

  const mlsWelcome: MlsMessage = commitResult.welcome!

  const [newFollowerGroupStatePayload, newFollowerGroupState] = updateEntity<FollowerGroupState>(
    followerGroupState,
    {
      groupState: newGroupState,
      cachedInteractions: new Map(),
    },
    encodeFollowerGroupState,
    masterKey,
  )

  const extraInstruction: ExtraInstruction = {
    kind: "addFollower",
    ids: [followerId],
  }

  const [newPagePayload, newPage] = updateEntity<PostManifestPage>(page, page, encodePostManifestPage, newSecret)

  //todo include call to follow in here
  //todo todo should there be transactional semantics for this?
  await Promise.all([
    batchEncryptAndStoreWithSecrets(
      remoteStore,
      [
        newPostManifestPayload,
        newPagePayload,
        newManifestPayload,
        newFollowerGroupStatePayload,
        newFollowRequestsPayload,
      ],
      extraInstruction,
    ),

    messageClient.sendMessage({
      payload: encodeMessagePublic({ mlsMessage: encode(mlsMessageEncoder, mlsWelcome), kind: "GroupMessage" }),
      recipients: [followerId],
    }),
    recipients.length > 0
      ? messageClient.sendMessage({
          payload: encodeMessagePublic({
            mlsMessage: encode(mlsMessageEncoder, commitResult.commit),
            kind: "GroupMessage",
          }),
          recipients: recipients,
        })
      : Promise.resolve(),
  ])

  return [newFollowRequests, newFollowerGroupState, newManifest, newPostManifest, newPage]
}

export async function processAllowFollow(
  followeeId: string,
  welcome: Welcome,
  followRequests: Entity<FollowRequests>,
  masterKey: Uint8Array,
  manifest: Entity<Manifest>,
  remoteStore: RemoteStore,
  mls: MlsContext,
): Promise<[Entity<FollowRequests>, Entity<Manifest>, Entity<FollowerManifest>, Entity<FollowerGroupState>]> {
  const { keyPackage, privateKeyPackage } = followRequests.outgoing.find((fr) => fr.followeeId === followeeId)!

  const kp = decode(keyPackageDecoder, keyPackage)!
  const pkp = decodePrivateKeyPackage(privateKeyPackage)

  const { state: group, groupInfoExtensions: extensions } = await joinGroupWithExtensions({
    welcome,
    keyPackage: kp,
    privateKeys: pkp,
    context: mls,
  })

  const followerManifestExtension = extensions.find((ex) => ex.extensionType === followerManifestExtensionType)
  if (!followerManifestExtension) throw new Error("Could not find follower manifest extension")

  const [followerManifestStoragePayload, followerManifest] = newEntity(
    decodeFollowerManifest(followerManifestExtension.extensionData),
    masterKey,
    encodeFollowerManifest,
  )

  const newFollowerManifests: Map<string, Uint8Array> = new Map([
    ...manifest.followerManifests,
    [followeeId, followerManifestStoragePayload.storageId],
  ])

  const [newFollowRequestsPayload, newFollowRequests] = updateEntity<FollowRequests>(
    followRequests,
    {
      incoming: followRequests.incoming,
      outgoing: followRequests.outgoing.filter((fr) => fr.followeeId !== followeeId),
    },
    encodeFollowRequests,
    masterKey,
  )

  const [followerGroupStatePayload, followerGroupState] = newEntity<FollowerGroupState>(
    {
      groupState: group,
      cachedInteractions: new Map(),
    },
    masterKey,
    encodeFollowerGroupState,
  )

  const newGroupStateManifest = new Map([
    ...manifest.groupStates,
    [uint8ToBase64Url(await deriveGroupIdFromUserId(followeeId)), followerGroupStatePayload.storageId],
  ])

  const [newManifestPayload, newManifest] = updateEntity<Manifest>(
    manifest,
    {
      ...manifest,
      groupStates: newGroupStateManifest,
      followerManifests: newFollowerManifests,
    },
    encodeManifest,
    masterKey,
  )

  await batchEncryptAndStoreWithSecrets(remoteStore, [
    followerGroupStatePayload,
    newFollowRequestsPayload,
    followerManifestStoragePayload,
    newManifestPayload,
  ])

  return [newFollowRequests, newManifest, followerManifest, followerGroupState]
}
