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
  CustomExtension,
  makeCustomExtension,
  mlsMessageEncoder,
} from "ts-mls"
import { Welcome } from "ts-mls/welcome.js"
import { deriveGroupIdFromUserId, recipientsFromMlsState } from "./mlsInteractions"
import { nodeToLeafIndex, toLeafIndex, toNodeIndex } from "ts-mls/treemath.js"
import { FollowerGroupState, FollowerManifest, Manifest, PostManifest, PostManifestPage } from "./manifest"
import { base64urlToUint8, RemoteStore, uint8ToBase64Url } from "./remoteStore"
import { encodeFollowerManifest, encodeFollowRequests, encodeClientState, encodeManifest, encodeMessagePublic, encodePostManifest, encodePostManifestPage, encodePrivateKeyPackage, encodeFollowerGroupState } from "./codec/encode"
import { derivePostSecret, encryptAndStoreWithPostSecret } from "./createPost"
import { decodeFollowerManifest, decodePrivateKeyPackage } from "./codec/decode"
import { SignatureKeyPair } from "./init"
import { keyPackageDecoder, keyPackageEncoder } from "ts-mls/keyPackage.js"
import { isDefaultCredential } from "ts-mls/credential.js"

export interface FollowRequests {
  outgoing: {followeeId: string, keyPackage: Uint8Array, privateKeyPackage: Uint8Array}[]
  incoming: {followerId: string, keyPackage: Uint8Array}[]
}

export function getAllFollowers(mlsGroup: ClientState): Uint8Array[] {
  const result: Uint8Array[] = []
  for (const [n, node] of mlsGroup.ratchetTree.entries()) {
    if (node?.nodeType === nodeTypes.leaf && nodeToLeafIndex(toNodeIndex(n)) !== toLeafIndex(mlsGroup.privatePath.leafIndex)) {
      if (!isDefaultCredential(node.leaf.credential) || node.leaf.credential.credentialType !== defaultCredentialTypes.basic) throw new Error("No good")
      result.push(node.leaf.credential.identity)
    }
  }
  return result
}

export function getAllFollowersForNonOwner(mlsGroup: ClientState, userId: string): Uint8Array[] {
  const result: Uint8Array[] = []
  for (const node of mlsGroup.ratchetTree) {
    if (node?.nodeType === nodeTypes.leaf) {
      if (!isDefaultCredential(node.leaf.credential) || node.leaf.credential.credentialType !== defaultCredentialTypes.basic) throw new Error("No good")
      const decoded = new TextDecoder().decode(node.leaf.credential.identity)
      if (decoded !== userId) result.push(node.leaf.credential.identity)
    }
  }
  return result
}

export const followerManifestExtensionType = 0x0AAA

export function getAllFollowees(manifest: Manifest): string[] {
  return [...manifest.followerManifests.keys()]
}

export async function requestFollow(
  credential: Credential,
  followeeId: string,
  signatureKeyPair: SignatureKeyPair,
  followRequests: FollowRequests,
  followRequestsId: Uint8Array,
  masterKey: Uint8Array,
  messageClient: MessageClient,
  remoteStore: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<FollowRequests> {
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey({
    credential,
    signatureKeyPair,
    cipherSuite: impl,
  })

  const encodedPublicPackage = encode(keyPackageEncoder, publicPackage) //todo should this be encoded as mlsMessage?

  const msg: MessagePublic = { kind: "FollowRequest", keyPackage: encodedPublicPackage } 

  const newFollowRequests: FollowRequests = {
    incoming: followRequests.incoming,
    outgoing: [
      {followeeId, keyPackage: encodedPublicPackage, privateKeyPackage: encodePrivateKeyPackage(privatePackage)}, 
      ...followRequests.outgoing
    ]
  }

  await Promise.all([
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowRequests(newFollowRequests), followRequestsId),
    messageClient.sendMessage({ payload: encodeMessagePublic(msg), recipients: [followeeId] })
  ])

  return newFollowRequests
}



export async function receiveFollowRequest(
  keyPackage: Uint8Array,
  followerId: string,
  followRequests: FollowRequests,
  followRequestsId: Uint8Array,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
): Promise<FollowRequests> {
  const newFollowRequests: FollowRequests = {
    incoming: [
      {keyPackage, followerId},
      ...followRequests.incoming
    ],
    outgoing: followRequests.outgoing
  }

  await encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowRequests(newFollowRequests), followRequestsId)

  return newFollowRequests
}

export async function allowFollow(
  followerId: string,
  followeeId: string,
  keyPackage: KeyPackage,
  followRequests: FollowRequests,
  page: PostManifestPage,
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  remoteStore: RemoteStore,
  messageClient: MessageClient,
  clientState: ClientState,
  impl: CiphersuiteImpl,
): Promise<[FollowRequests, ClientState, Manifest, PostManifest]> {
  const addProposal: Proposal = {
    proposalType: defaultProposalTypes.add,
    add: { keyPackage },
  }

  //include FollowerManifest (id of post manifest and current page) in groupInfoExtensions to send in the welcome
  const followerManifest: FollowerManifest = {
    postManifest: manifest.postManifest,
    currentPage: postManifest.currentPage
  }
  const extension: CustomExtension = makeCustomExtension(
    followerManifestExtensionType,
    encodeFollowerManifest(followerManifest),
  )

  const commitResult = await createCommit(
    { state: clientState, context: {cipherSuite: impl, authService: unsafeTestingAuthenticationService} , extraProposals: [addProposal], groupInfoExtensions: [extension], ratchetTreeExtension: true},
  )


  const newFollowRequests: FollowRequests = {
    incoming: followRequests.incoming.filter(fr => fr.followerId !== followerId),
    outgoing: followRequests.outgoing
  }

  const newGroupState = commitResult.newState
  //todo there are a lot of optimizations we could do that cache the current post secret so we don't have to re-derive it everytime.
  const newSecret = await derivePostSecret(newGroupState, impl)

  const newPostManifest: PostManifest = {
    ...postManifest,
    currentPage: [postManifest.currentPage[0], newSecret]
  }

  const newManifest: Manifest = {
    ...manifest,
    postManifest: [manifest.postManifest[0], newSecret]
  }

  const groupId = uint8ToBase64Url(newGroupState.groupContext.groupId)

  const groupStateStorageId = manifest.groupStates.get(groupId)!

  const recipients = recipientsFromMlsState([followerId, followeeId], clientState)

  const mlsWelcome: MlsMessage = commitResult.welcome!

  const followerGroupState: FollowerGroupState = {
    groupState: encodeClientState(newGroupState),
    cachedInteractions: new Map()
  }

  const [pmid, pmpid] = await Promise.all([
    encryptAndStoreWithPostSecret(newSecret, remoteStore, encodePostManifest(newPostManifest), base64urlToUint8(manifest.postManifest[0])),
    encryptAndStoreWithPostSecret(newSecret, remoteStore, encodePostManifestPage(page), base64urlToUint8(postManifest.currentPage[0])),
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeManifest(newManifest), manifestId),
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowerGroupState(followerGroupState), groupStateStorageId),
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowRequests(newFollowRequests), manifest.followRequests),
    messageClient.sendMessage({ payload: encodeMessagePublic({ mlsMessage: encode(mlsMessageEncoder, mlsWelcome), kind: "GroupMessage"}), recipients: [followerId] }),
    recipients.length > 0 ? messageClient.sendMessage({ payload:encodeMessagePublic({ mlsMessage: encode(mlsMessageEncoder, commitResult.commit), kind: "GroupMessage"}), recipients: recipients }) : Promise.resolve(),
    //localStore.storeGroupState(commitResult.newState),
  ])
  
  return [newFollowRequests, newGroupState, newManifest, newPostManifest]
}

export async function processAllowFollow(
  followeeId: string,
  welcome: Welcome,
  followRequests: FollowRequests,
  masterKey: Uint8Array,
  manifest: Manifest,
  manifestId: Uint8Array,
  remoteStore: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<[FollowRequests, Manifest, FollowerManifest, ClientState]> {

  const {keyPackage, privateKeyPackage } = followRequests.outgoing.find(fr => fr.followeeId === followeeId)!

  const kp = decode(keyPackageDecoder, keyPackage)!
  const pkp = decodePrivateKeyPackage(privateKeyPackage)

  const {state:group, groupInfoExtensions: extensions} = await joinGroupWithExtensions({ welcome, keyPackage: kp, privateKeys: pkp, context: {authService: unsafeTestingAuthenticationService, cipherSuite: impl}})

  const followerManifestExtension = extensions.find(ex => ex.extensionType === followerManifestExtensionType)
  if (!followerManifestExtension) throw new Error("Could not find follower manifest extension")

  const followerManifest = decodeFollowerManifest(followerManifestExtension.extensionData)

  const followerManifestStorageId = crypto.getRandomValues(new Uint8Array(32))

  const newFollowerManifests: Map<string, Uint8Array> = 
    new Map([...manifest.followerManifests,
      [followeeId, followerManifestStorageId]
    ])
  

  const newFollowRequests: FollowRequests = {
    incoming: followRequests.incoming,
    outgoing: followRequests.outgoing.filter(fr => fr.followeeId !== followeeId)
  }

  const followerGroupState: FollowerGroupState = {
    groupState: encodeClientState(group) ,cachedInteractions: new Map()
  }

  const newGroupStateStorageId = crypto.getRandomValues(new Uint8Array(32))

  const newGroupStateManifest = 
    new Map([
      ...manifest.groupStates,
      [uint8ToBase64Url(await deriveGroupIdFromUserId(followeeId)), newGroupStateStorageId]
    ]);

  const newManifest: Manifest = {
    ...manifest,
    groupStates: newGroupStateManifest,
    followerManifests: newFollowerManifests,
  }

  await Promise.all([
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowerGroupState(followerGroupState), newGroupStateStorageId),
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowRequests(newFollowRequests), manifest.followRequests),
    encryptAndStoreWithPostSecret(masterKey, remoteStore, followerManifestExtension.extensionData, followerManifestStorageId),
    encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeManifest(newManifest), manifestId)
  ])

  return [newFollowRequests, newManifest, followerManifest, group]
}




