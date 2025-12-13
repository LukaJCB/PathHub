import { CiphersuiteImpl, createApplicationMessage, encodeMlsMessage, ClientState, bytesToBase64 } from "ts-mls"
import { deriveGroupIdFromUserId } from "./mlsInteractions"
import { CurrentPostManifest, DerivedMetrics, PostMeta, StorageIdentifier, upsertPost } from "./manifest"
import { encode } from "cbor-x"
import { MessageClient } from "./http/messageClient"

import { mlsExporter } from "ts-mls/keySchedule.js"
import { Message } from "./message"

import { LocalStore } from "./localStore"
import { recipientsFromMlsState } from "./mlsInteractions"
import { RemoteStore } from "./remoteStore"
import { bytesToArrayBuffer, toBufferSource } from "ts-mls/util/byteArray.js"

export const postLimit = 20

export async function createPost(
  content: Uint8Array,
  metrics: DerivedMetrics,
  title: string,
  userId: string,
  manifest: CurrentPostManifest,
  manifestId: Uint8Array,
  mlsGroup: ClientState,
  store: LocalStore,
  remoteStore: RemoteStore,
  messageClient: MessageClient,
  impl: CiphersuiteImpl,
  masterKey: Uint8Array
): Promise<[ClientState, CurrentPostManifest]> {

  //todo parallelize this with the updating of the manifest
  const storageIdentifier = await encryptAndStore(mlsGroup, impl, remoteStore, content)
  
  // update post manifest and totals

  if (manifest.posts.length >= postLimit) {
    //create new manifest and link old one
  }

  const postMeta: PostMeta = {
    title,
    date: Date.now(),
    metrics,
    totalLikes: 0,
    sampleLikes: [],
    totalComments: 0,
    sampleComments: [],
    main: storageIdentifier,
    comments: undefined,
    likes: undefined,
  }

  const newManifest = await updateManifest(manifest, postMeta, masterKey, remoteStore, manifestId)


  //await store.storeCurrentManifest(userId, newManifest, manifestId)

  // create MLS message of the post to group
  const msg: Message = { kind: "PostMessage", content: postMeta }

  const createMessageResult = await createApplicationMessage(mlsGroup, encode(msg), impl)

  // send message and store group state
  await Promise.all([
    // messageClient.sendMessage({
    //   payload: encodeMlsMessage({
    //     version: "mls10",
    //     wireformat: "mls_private_message",
    //     privateMessage: createMessageResult.privateMessage,
    //   }),
    //   recipients: recipientsFromMlsState([userId], mlsGroup),
    // }),
    store.storeGroupState(createMessageResult.newState),
  ])

  return [createMessageResult.newState, newManifest] as const
}


export async function updateManifest(manifest: CurrentPostManifest, postMeta: PostMeta, masterKey: Uint8Array, remoteStore: RemoteStore, manifestId: Uint8Array) {
  const newManifest = upsertPost(manifest, postMeta)

  await encryptAndStoreWithMasterKey(masterKey, remoteStore, encode(newManifest), manifestId)
  return newManifest
}

export async function encryptAndStoreWithMasterKey(masterKey: Uint8Array, remoteStore: RemoteStore, content: Uint8Array, storageId: Uint8Array): Promise<void> {
  // const { key, accessKey, postSecret } = await deriveKeys(mlsGroup, impl)
  const { key, accessKey } = await deriveAccessAndEncryptionKeys(masterKey)

  const nonce = crypto.getRandomValues(new Uint8Array(12))

  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    toBufferSource(content),
  )


  // store encrypted content remotely
  await remoteStore.storeContent(storageId, new Uint8Array(encryptedContent), nonce, new Uint8Array(accessKey))
 
}

export async function encryptAndStore(mlsGroup: ClientState, impl: CiphersuiteImpl, remoteStore: RemoteStore, content: Uint8Array, objectId?: Uint8Array): Promise<[string, Uint8Array]> {
  const { key, accessKey, postSecret } = await deriveKeys(mlsGroup, impl)

  const nonce = crypto.getRandomValues(new Uint8Array(12))



  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    toBufferSource(content),
  )


  // store encrypted content remotely
  const storageId = await remoteStore.storeContent(objectId ?? crypto.getRandomValues(new Uint8Array(32)), new Uint8Array(encryptedContent), nonce, new Uint8Array(accessKey))


  return [storageId, postSecret] as const
 
}

export async function deriveKeys(mlsGroup: ClientState, impl: CiphersuiteImpl): Promise<{ key: CryptoKey; accessKey: ArrayBuffer; postSecret: Uint8Array}> {
  const postSecret = await derivePostSecret(mlsGroup, impl)

  const { key, accessKey } = await deriveAccessAndEncryptionKeys(postSecret)

  return {key, accessKey, postSecret}
}

export async function deriveAccessAndEncryptionKeys(postSecret: Uint8Array) {
  const postSecretKdfIkm = await crypto.subtle.importKey("raw", toBufferSource(postSecret), "HKDF", false, ["deriveBits", "deriveKey"])
  const accessKey = await crypto.subtle.deriveBits({
    name: "HKDF",
    salt: new ArrayBuffer(),
    info: new TextEncoder().encode("access key"),
    hash: "SHA-256",
  }, postSecretKdfIkm, 256)

  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      salt: new ArrayBuffer(),
      info: new TextEncoder().encode("data encryption key"),
      hash: "SHA-256",
    },
    postSecretKdfIkm,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  )
  return { key, accessKey }
}

export async function derivePostSecret(mlsGroup: ClientState, impl: CiphersuiteImpl): Promise<Uint8Array> {
  return await mlsExporter(mlsGroup.keySchedule.exporterSecret, "data encryption key", new Uint8Array(), 32, impl)

  
}



function createManifestId(newManifest: CurrentPostManifest): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))) //todo use hash?
}
