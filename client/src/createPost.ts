import { CiphersuiteImpl, createApplicationMessage, ClientState, bytesToBase64 } from "ts-mls"
import { CurrentPostManifest, DerivedMetrics, Manifest, overflowManifest, PostMeta, StorageIdentifier, upsertPost } from "./manifest"
import { encode } from "cbor-x"
import { MessageClient } from "./http/messageClient"

import { mlsExporter } from "ts-mls/keySchedule.js"
import { Message } from "./message"

import { LocalStore } from "./localStore"
import { base64urlToUint8, RemoteStore } from "./remoteStore"
import { toBufferSource } from "ts-mls/util/byteArray.js"
import { encodeCurrentPostManifest, encodeManifest } from "./codec/encode"

export const postLimit = 20

export async function createPost(
  content: Uint8Array,
  metrics: DerivedMetrics,
  title: string,
  thumbnail: Uint8Array,
  media: Uint8Array[],
  date: number,
  userId: string,
  postManifest: CurrentPostManifest,
  postManifestId: StorageIdentifier,
  mlsGroup: ClientState,
  manifest: Manifest,
  manifestId: Uint8Array,
  store: LocalStore,
  remoteStore: RemoteStore,
  messageClient: MessageClient,
  impl: CiphersuiteImpl,
  masterKey: Uint8Array
): Promise<[ClientState, CurrentPostManifest, Manifest]> {

  //todo parallelize this with the updating of the manifest
  const storageIdentifier = await encryptAndStore(mlsGroup, impl, remoteStore, content)

  const mediaIds = await Promise.all(media.map(m => encryptAndStore(mlsGroup, impl, remoteStore, m)))

  const thumbnailId = await encryptAndStore(mlsGroup, impl, remoteStore, thumbnail)

  const postMeta: PostMeta = {
    title,
    date,
    metrics,
    totalLikes: 0,
    sampleLikes: [],
    totalComments: 0,
    sampleComments: [],
    main: storageIdentifier,
    comments: undefined,
    likes: undefined,
    media: mediaIds,
    thumbnail: thumbnailId
  }


  // create MLS message of the post to group
  const msg: Message = { kind: "PostMessage", content: postMeta }

  const createMessageResult = await createApplicationMessage(mlsGroup, encode(msg), impl)

  // messageClient.sendMessage({
  //   payload: encodeMlsMessage({
  //     version: "mls10",
  //     wireformat: "mls_private_message",
  //     privateMessage: createMessageResult.privateMessage,
  //   }),
  //   recipients: recipientsFromMlsState([userId], mlsGroup),
  // }),

  if (postManifest.posts.length >= postLimit) {
    //create new manifest and link old one

    const newPostManifest = overflowManifest(postManifest, postManifestId, postMeta)

    
    const newPostManifestId = await encryptAndStore(mlsGroup, impl, remoteStore, encodeCurrentPostManifest(newPostManifest))

    const newManifest: Manifest = {...manifest, currentPostManifest: newPostManifestId}

    await encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeManifest(newManifest), manifestId)

    return [createMessageResult.newState, newPostManifest, newManifest] as const
  }


  const newPostManifest = await updatePostManifest(postManifest, postMeta, postManifestId, remoteStore)


  await store.storeGroupState(createMessageResult.newState)

  return [createMessageResult.newState, newPostManifest, manifest] as const
}


export async function updatePostManifest(manifest: CurrentPostManifest, postMeta: PostMeta, postManifestId: StorageIdentifier, remoteStore: RemoteStore) {
  const newManifest = upsertPost(manifest, postMeta)

  await encryptAndStoreWithPostSecret(postManifestId[1], remoteStore, encodeCurrentPostManifest(newManifest), base64urlToUint8(postManifestId[0]))
  return newManifest
}


export async function encryptAndStoreWithPostSecret(postSecret: Uint8Array, remoteStore: RemoteStore, content: Uint8Array, storageId: Uint8Array): Promise<void> {
  // const { key, accessKey, postSecret } = await deriveKeys(mlsGroup, impl)
  const { key, accessKey } = await deriveAccessAndEncryptionKeys(postSecret)

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


