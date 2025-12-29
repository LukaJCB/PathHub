import { CiphersuiteImpl, createApplicationMessage, ClientState } from "ts-mls"
import { PostManifestPage, DerivedMetrics, Manifest, PostManifest, PostMeta, StorageIdentifier, addDerivedMetrics } from "./manifest"
import { encode } from "cbor-x"
import { MessageClient } from "./http/messageClient"

import { mlsExporter } from "ts-mls/keySchedule.js"
import { Message } from "./message"

import { LocalStore } from "./localStore"
import { base64urlToUint8, RemoteStore } from "./remoteStore"
import { toBufferSource } from "ts-mls/util/byteArray.js"
import { encodePostManifestPage, encodeManifest, encodePostManifest } from "./codec/encode"

export const postLimit = 10

export async function createPost(
  content: Uint8Array,
  metrics: DerivedMetrics,
  title: string,
  thumbnail: Uint8Array,
  media: Uint8Array[],
  date: number,
  userId: string,
  page: PostManifestPage,
  postManifest: PostManifest,
  mlsGroup: ClientState,
  manifest: Manifest,
  manifestId: Uint8Array,
  store: LocalStore,
  remoteStore: RemoteStore,
  messageClient: MessageClient,
  impl: CiphersuiteImpl,
  masterKey: Uint8Array
): Promise<[ClientState, PostManifestPage, PostManifest, Manifest]> {

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

  if (page.posts.length >= postLimit) {
    //create new manifest and link old one

    const [newPage, newPostManifest, newManifest] = await overflowManifest(mlsGroup, impl, page, postManifest, manifest, manifestId, 
      masterKey, postMeta, remoteStore)


    return [createMessageResult.newState, newPage, newPostManifest, newManifest]
  }

  const [newPage, newPostManifest, newManifest] = await addToPage(mlsGroup, impl, page, postManifest, manifest, manifestId, masterKey, postMeta, remoteStore)



  await store.storeGroupState(createMessageResult.newState)

  return [createMessageResult.newState, newPage, newPostManifest, newManifest]
}


export async function addToPage(
  mlsGroup: ClientState,
  impl: CiphersuiteImpl,
  page: PostManifestPage, 
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  remoteStore: RemoteStore
): Promise<[PostManifestPage, PostManifest, Manifest]> {

  const newPage = {
    posts: [postMeta, ...page.posts],
    pageIndex: page.pageIndex
  }


  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  let newPageId = postManifest.currentPage

  const currentPostSecret = await derivePostSecret(mlsGroup, impl)
  if (compareUint8Arrays(currentPostSecret, postManifest.currentPage[1])) {
    await encryptAndStoreWithPostSecret(currentPostSecret, remoteStore, encodePostManifestPage(newPage), base64urlToUint8(postManifest.currentPage[0]))
  } else {
    newPageId = await encryptAndStore(mlsGroup, impl, remoteStore, encodePostManifestPage(newPage), base64urlToUint8(postManifest.currentPage[0]))
  }

  const newPostManifest = {
    totals: updatedTotals,
    pages: postManifest.pages,
    currentPage: newPageId
  }

  
  const newManifest = await updatePostManifest(remoteStore, newPostManifest, mlsGroup, impl, manifest, masterKey, manifestId)


  
  
  return [newPage, newPostManifest, newManifest ?? manifest]
  
}


export async function replaceInPage(
  mlsGroup: ClientState,
  impl: CiphersuiteImpl,
  page: PostManifestPage,
  pageId: StorageIdentifier,
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  remoteStore: RemoteStore
): Promise<[PostManifestPage, PostManifest, Manifest]> {

  const newPage = {
    posts: page.posts.map(pm => {
      if (pm.main[0] === postMeta.main[0]) {
        return postMeta
      }
      return pm
    }),
    pageIndex: page.pageIndex
  }


  let newPageId = pageId

  const currentPostSecret = await derivePostSecret(mlsGroup, impl)
  if (compareUint8Arrays(currentPostSecret, pageId[1])) {
    await encryptAndStoreWithPostSecret(currentPostSecret, remoteStore, encodePostManifestPage(newPage), base64urlToUint8(pageId[0]))

    return [newPage, postManifest, manifest]
  } else {
    newPageId = await encryptAndStore(mlsGroup, impl, remoteStore, encodePostManifestPage(newPage), base64urlToUint8(pageId[0]))

    // update postManifest to replace the existing page with the new page
    const newPostManifest = replacePage(pageId, newPageId, postManifest)

    // see if the postManifest is still encrypted by the most recent secret, if it is do nothing,
    //  otherwise re-encrypt and update the manifest
    const newManifest = await updatePostManifest(remoteStore, newPostManifest, mlsGroup, impl, manifest, masterKey, manifestId)
  
  
    return [newPage, newPostManifest, newManifest ?? manifest]
  }

  

  
  
}

function replacePage(oldPageId: StorageIdentifier, newPageId: StorageIdentifier, pm: PostManifest): PostManifest {
  if (pm.currentPage[0] === oldPageId[0]) {
    return {...pm, currentPage: newPageId}
  }

  const newPages = pm.pages.map(p => {
    if (p.page[0] === oldPageId[0]) {
      return { usedUntil: p.usedUntil, page: newPageId }
    }
    return p
  })

  return {...pm, pages: newPages}
}

//PostManifestPage -> postManifestIndex -> [PostManifestPage] 

export async function overflowManifest(
  mlsGroup: ClientState,
  impl: CiphersuiteImpl,
  page: PostManifestPage, 
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  remoteStore: RemoteStore
): Promise<[PostManifestPage, PostManifest, Manifest]> {

  //if current secret == storageId secret {
  // update in place.
  //} else {
  // delete and replace PostManifestPage with new secret
  // as part of this, also fetch the post manifest and delete and replace post manifest with new secret
  //}

  const newPage = {
    posts: [postMeta],
    pageIndex: page.pageIndex + 1,
  }

  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  
  const newPageId = await encryptAndStore(mlsGroup, impl, remoteStore, encodePostManifestPage(newPage))

  const newPostManifest = {
    totals: updatedTotals,
    pages: [...postManifest.pages, {usedUntil: Date.now(), page: postManifest.currentPage}],
    currentPage: newPageId
  }
  
  const newManifest = await updatePostManifest(remoteStore, newPostManifest, mlsGroup, impl, manifest, masterKey, manifestId)

  
  return [newPage, newPostManifest, newManifest ?? manifest]
}


async function updatePostManifest(
  remoteStore: RemoteStore, 
  newPostManifest: PostManifest, 
  mlsGroup: ClientState, 
  impl: CiphersuiteImpl, 
  manifest: Manifest, 
  masterKey: Uint8Array, 
  manifestId: Uint8Array): Promise<undefined | Manifest> {
  const currentPostSecret = await derivePostSecret(mlsGroup, impl)
  if (compareUint8Arrays(currentPostSecret, manifest.postManifest[1])) {
    await encryptAndStoreWithPostSecret(currentPostSecret, remoteStore, encodePostManifest(newPostManifest), base64urlToUint8(manifest.postManifest[0]))

    return manifest
  } else {
    const newPostManifestId = await encryptAndStore(mlsGroup, impl, remoteStore, encodePostManifest(newPostManifest), base64urlToUint8(manifest.postManifest[0]))

    const newManifest: Manifest = { ...manifest, postManifest: newPostManifestId }

    await encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeManifest(newManifest), manifestId)

    return newManifest
  }

}

// export async function updatePostManifest(manifest: PostManifestPage, postMeta: PostMeta, postManifestId: StorageIdentifier, remoteStore: RemoteStore) {
//   const newManifest = upsertPost(manifest, postMeta)

//   await encryptAndStoreWithPostSecret(postManifestId[1], remoteStore, encodePostManifestPage(newManifest), base64urlToUint8(postManifestId[0]))
//   return newManifest
// }


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

function compareUint8Arrays(arr1: Uint8Array, arr2: Uint8Array): boolean {
    if (arr1.length !== arr2.length) {
        return false;
    }

    for (let i = 0; i < arr1.length; i++) {
        if (arr1[i] !== arr2[i]) {
            return false; 
        }
    }

    return true;
}


