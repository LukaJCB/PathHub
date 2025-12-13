import { Message } from "./message"
import { encode } from "cbor-x"
import { MessageClient } from "./http/messageClient"
import {
  CiphersuiteImpl,
  ClientState,
  createCommit,
  encodeMlsMessage,
  generateKeyPackageWithKey,
  joinGroup,
  KeyPackage,
  Proposal,
  PrivateKeyPackage,
  emptyPskIndex,
  Credential,
  defaultCapabilities,
  defaultLifetime,
} from "ts-mls"
import { encodeKeyPackage } from "ts-mls/keyPackage.js"
import { encodeWelcome, Welcome } from "ts-mls/welcome.js"
import { LocalStore } from "./localStore"
import { recipientsFromMlsState } from "./mlsInteractions"

export async function requestFollow(
  credential: Credential,
  followeeId: string,
  signatureKeyPair: {
    signKey: Uint8Array
    publicKey: Uint8Array
  },
  messageClient: MessageClient,
  localStore: LocalStore,
  impl: CiphersuiteImpl,
): Promise<void> {
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey(
    credential,
    defaultCapabilities(),
    defaultLifetime,
    [],
    signatureKeyPair,
    impl,
  )

  const msg: Message = { kind: "FollowRequest", keyPackage: encodeKeyPackage(publicPackage) } //todo should this be encoded as mlsMessage?

  await localStore.storeFollowRequest(followeeId, publicPackage, privatePackage)

  await messageClient.sendMessage({ payload: encode(msg), recipients: [followeeId] })
}

export async function allowFollow(
  followerId: string,
  followeeId: string,
  keyPackage: KeyPackage,
  messageClient: MessageClient,
  localStore: LocalStore,
  clientState: ClientState,
  impl: CiphersuiteImpl,
): Promise<void> {
  const addProposal: Proposal = {
    proposalType: "add",
    add: { keyPackage },
  }

  const commitResult = await createCommit(
    { state: clientState, cipherSuite: impl },
    { extraProposals: [addProposal], ratchetTreeExtension: true },
  )

  await Promise.all([
    messageClient.sendMessage({ payload: encodeWelcome(commitResult.welcome!), recipients: [followerId] }), //todo should this be encoded as mlsMessage?
    messageClient.sendMessage({ payload: encodeMlsMessage(commitResult.commit), recipients: recipientsFromMlsState([followerId, followeeId], clientState) }),
    localStore.storeGroupState(clientState),
  ])
}

export async function processAllowFollow(
  followeeId: string,
  welcome: Welcome,
  keyPackage: KeyPackage,
  privateKeyPackage: PrivateKeyPackage,
  localStore: LocalStore,
  impl: CiphersuiteImpl,
): Promise<void> {
  const group = await joinGroup(welcome, keyPackage, privateKeyPackage, emptyPskIndex, impl)

  await Promise.all([
  localStore.removeFollowRequest(followeeId)
  ,localStore.storeGroupState(group)
  ])

}




