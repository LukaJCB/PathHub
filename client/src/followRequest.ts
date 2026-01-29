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
  unsafeTestingAuthenticationService,
  defaultProposalTypes,
  encode,
  nodeTypes,
  defaultCredentialTypes,
  makeCustomExtension,
  mlsMessageEncoder,
  GroupInfoExtension,
} from "ts-mls"
import { Welcome } from "ts-mls/welcome.js"
import { deriveGroupIdFromUserId, recipientsFromMlsState } from "./mlsInteractions"
import { nodeToLeafIndex, toLeafIndex, toNodeIndex } from "ts-mls/treemath.js"
import { FollowerGroupState, FollowerManifest, Manifest, PostManifest, PostManifestPage, Versioned } from "./manifest"
import { base64urlToUint8, RemoteStore, uint8ToBase64Url } from "./remoteStore"
import {
  encodeFollowerManifest,
  encodeFollowRequests,
  encodeClientState,
  encodeManifest,
  encodeMessagePublic,
  encodePostManifest,
  encodePostManifestPage,
  encodePrivateKeyPackage,
  encodeFollowerGroupState,
} from "./codec/encode"
import { batchEncryptAndStoreWithSecrets, derivePostSecret, encryptAndStoreWithPostSecret } from "./createPost"
import { decodeFollowerManifest, decodePrivateKeyPackage } from "./codec/decode"
import { SignatureKeyPair } from "./init"
import { keyPackageDecoder, keyPackageEncoder } from "ts-mls/keyPackage.js"
import { isDefaultCredential } from "ts-mls/credential.js"

export interface FollowRequests {
  outgoing: { followeeId: string; keyPackage: Uint8Array; privateKeyPackage: Uint8Array }[]
  incoming: { followerId: string; keyPackage: Uint8Array }[]
}

export function getAllFollowers(mlsGroup: ClientState): Uint8Array[] {
  const result: Uint8Array[] = []
  for (const [n, node] of mlsGroup.ratchetTree.entries()) {
    if (
      node?.nodeType === nodeTypes.leaf &&
      nodeToLeafIndex(toNodeIndex(n)) !== toLeafIndex(mlsGroup.privatePath.leafIndex)
    ) {
      if (
        !isDefaultCredential(node.leaf.credential) ||
        node.leaf.credential.credentialType !== defaultCredentialTypes.basic
      )
        throw new Error("No good")
      result.push(node.leaf.credential.identity)
    }
  }
  return result
}

export function getAllFollowersForNonOwner(mlsGroup: ClientState, userId: string): Uint8Array[] {
  const result: Uint8Array[] = []
  for (const node of mlsGroup.ratchetTree) {
    if (node?.nodeType === nodeTypes.leaf) {
      if (
        !isDefaultCredential(node.leaf.credential) ||
        node.leaf.credential.credentialType !== defaultCredentialTypes.basic
      )
        throw new Error("No good")
      const decoded = new TextDecoder().decode(node.leaf.credential.identity)
      if (decoded !== userId) result.push(node.leaf.credential.identity)
    }
  }
  return result
}

export const followerManifestExtensionType = 0x0aaa

export function getAllFollowees(manifest: Manifest): string[] {
  return [...manifest.followerManifests.keys()]
}

export async function requestFollow(
  credential: Credential,
  followeeId: string,
  signatureKeyPair: SignatureKeyPair,
  followRequests: Versioned<FollowRequests>,
  followRequestsId: Uint8Array,
  masterKey: Uint8Array,
  messageClient: MessageClient,
  remoteStore: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<Versioned<FollowRequests>> {
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey({
    credential,
    signatureKeyPair,
    cipherSuite: impl,
  })

  const encodedPublicPackage = encode(keyPackageEncoder, publicPackage) //todo should this be encoded as mlsMessage?

  const msg: MessagePublic = { kind: "FollowRequest", keyPackage: encodedPublicPackage }

  const newFollowRequests: Versioned<FollowRequests> = {
    incoming: followRequests.incoming,
    outgoing: [
      { followeeId, keyPackage: encodedPublicPackage, privateKeyPackage: encodePrivateKeyPackage(privatePackage) },
      ...followRequests.outgoing,
    ],
    version: followRequests.version + 1n,
  }

  await Promise.all([
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowRequests(newFollowRequests), followRequestsId),
    messageClient.sendMessage({ payload: encodeMessagePublic(msg), recipients: [followeeId] }),
  ])

  return newFollowRequests
}

export async function receiveFollowRequest(
  keyPackage: Uint8Array,
  followerId: string,
  followRequests: Versioned<FollowRequests>,
  followRequestsId: Uint8Array,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
): Promise<Versioned<FollowRequests>> {
  const newFollowRequests: Versioned<FollowRequests> = {
    incoming: [{ keyPackage, followerId }, ...followRequests.incoming],
    outgoing: followRequests.outgoing,
    version: followRequests.version + 1n,
  }

  await encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowRequests(newFollowRequests), followRequestsId)

  return newFollowRequests
}

export async function allowFollow(
  followerId: string,
  followeeId: string,
  keyPackage: KeyPackage,
  followRequests: Versioned<FollowRequests>,
  page: Versioned<PostManifestPage>,
  postManifest: Versioned<PostManifest>,
  manifest: Versioned<Manifest>,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
  messageClient: MessageClient,
  clientState: Versioned<ClientState>,
  impl: CiphersuiteImpl,
): Promise<[Versioned<FollowRequests>, Versioned<ClientState>, Versioned<Manifest>, Versioned<PostManifest>]> {
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

  // const extension: GroupInfoExtension = makeCustomExtension(
  //   followerManifestExtensionType,
  //   encodeFollowerManifest(followerManifest),
  // )

  const commitResult = await createCommit({
    state: clientState,
    context: { cipherSuite: impl, authService: unsafeTestingAuthenticationService },
    extraProposals: [addProposal],
    groupInfoExtensions: [extension],
    ratchetTreeExtension: true,
  })

  const newFollowRequests: Versioned<FollowRequests> = {
    incoming: followRequests.incoming.filter((fr) => fr.followerId !== followerId),
    outgoing: followRequests.outgoing,
    version: followRequests.version + 1n,
  }

  const newGroupState = commitResult.newState
  //todo there are a lot of optimizations we could do that cache the current post secret so we don't have to re-derive it everytime.
  const newSecret = await derivePostSecret(newGroupState, impl)

  const newPostManifest: Versioned<PostManifest> = {
    ...postManifest,
    currentPage: [postManifest.currentPage[0], newSecret],
    version: postManifest.version + 1n,
  }

  const newManifest: Versioned<Manifest> = {
    ...manifest,
    postManifest: [manifest.postManifest[0], newSecret],
    version: manifest.version + 1n,
  }

  const groupId = uint8ToBase64Url(newGroupState.groupContext.groupId)

  const groupStateStorageId = manifest.groupStates.get(groupId)!

  const recipients = recipientsFromMlsState([followerId, followeeId], clientState)

  const mlsWelcome: MlsMessage = commitResult.welcome!

  const followerGroupState: FollowerGroupState = {
    groupState: encodeClientState(newGroupState),
    cachedInteractions: new Map(),
  }

  await Promise.all([
    batchEncryptAndStoreWithSecrets(remoteStore, [
      {
        postSecret: newSecret,
        storageId: base64urlToUint8(manifest.postManifest[0]),
        content: encodePostManifest(newPostManifest),
        version: postManifest.version,
      },
      {
        postSecret: newSecret,
        storageId: base64urlToUint8(postManifest.currentPage[0]),
        content: encodePostManifestPage(page),
        version: page.version,
      },
      { postSecret: masterKey, storageId: manifestId, content: encodeManifest(newManifest), version: manifest.version },
      {
        postSecret: masterKey,
        storageId: groupStateStorageId,
        content: encodeFollowerGroupState(followerGroupState),
        version: clientState.version,
      },
      {
        postSecret: masterKey,
        storageId: manifest.followRequests,
        content: encodeFollowRequests(newFollowRequests),
        version: followRequests.version,
      },
    ]),
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
    //localStore.storeGroupState(commitResult.newState),
  ])

  return [newFollowRequests, { ...newGroupState, version: clientState.version + 1n }, newManifest, newPostManifest]
}

export async function processAllowFollow(
  followeeId: string,
  welcome: Welcome,
  followRequests: Versioned<FollowRequests>,
  masterKey: Uint8Array,
  manifest: Versioned<Manifest>,
  manifestId: Uint8Array,
  remoteStore: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<[Versioned<FollowRequests>, Versioned<Manifest>, Versioned<FollowerManifest>, ClientState]> {
  const { keyPackage, privateKeyPackage } = followRequests.outgoing.find((fr) => fr.followeeId === followeeId)!

  const kp = decode(keyPackageDecoder, keyPackage)!
  const pkp = decodePrivateKeyPackage(privateKeyPackage)

  const { state: group, groupInfoExtensions: extensions } = await joinGroupWithExtensions({
    welcome,
    keyPackage: kp,
    privateKeys: pkp,
    context: { authService: unsafeTestingAuthenticationService, cipherSuite: impl },
  })

  const followerManifestExtension = extensions.find((ex) => ex.extensionType === followerManifestExtensionType)
  if (!followerManifestExtension) throw new Error("Could not find follower manifest extension")

  const followerManifest = decodeFollowerManifest(followerManifestExtension.extensionData)

  const followerManifestStorageId = crypto.getRandomValues(new Uint8Array(32))

  const newFollowerManifests: Map<string, Uint8Array> = new Map([
    ...manifest.followerManifests,
    [followeeId, followerManifestStorageId],
  ])

  const newFollowRequests: Versioned<FollowRequests> = {
    incoming: followRequests.incoming,
    outgoing: followRequests.outgoing.filter((fr) => fr.followeeId !== followeeId),
    version: followRequests.version + 1n,
  }

  const followerGroupState: FollowerGroupState = {
    groupState: encodeClientState(group),
    cachedInteractions: new Map(),
  }

  const newGroupStateStorageId = crypto.getRandomValues(new Uint8Array(32))

  const newGroupStateManifest = new Map([
    ...manifest.groupStates,
    [uint8ToBase64Url(await deriveGroupIdFromUserId(followeeId)), newGroupStateStorageId],
  ])

  const newManifest: Versioned<Manifest> = {
    ...manifest,
    groupStates: newGroupStateManifest,
    followerManifests: newFollowerManifests,
    version: manifest.version + 1n,
  }

  await batchEncryptAndStoreWithSecrets(remoteStore, [
    {
      postSecret: masterKey,
      storageId: newGroupStateStorageId,
      content: encodeFollowerGroupState(followerGroupState),
      version: 0n,
    },
    {
      postSecret: masterKey,
      storageId: manifest.followRequests,
      content: encodeFollowRequests(newFollowRequests),
      version: followRequests.version,
    },
    {
      postSecret: masterKey,
      storageId: followerManifestStorageId,
      content: followerManifestExtension.extensionData,
      version: 0n,
    },
    { postSecret: masterKey, storageId: manifestId, content: encodeManifest(newManifest), version: manifest.version },
  ])

  return [newFollowRequests, newManifest, { ...followerManifest, version: 0n }, group]
}
