import { CiphersuiteImpl, createApplicationMessage, ClientState, unsafeTestingAuthenticationService } from "ts-mls"
import { PostManifestPage, DerivedMetrics, Manifest, PostManifest, PostMeta, StorageIdentifier, addDerivedMetrics, IndexCollection, IndexManifest } from "./manifest"
import { encode, decode } from "cbor-x"
import { MessageClient } from "./http/messageClient"

import { mlsExporter } from "ts-mls/keySchedule.js"
import { Message } from "./message"
import { addPostToIndexes } from "./indexing"

import { LocalStore } from "./localStore"
import { base64urlToUint8, RemoteStore, retrieveAndDecryptContent, uint8ToBase64Url } from "./remoteStore"
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
  description: string,
  postType: string | undefined,
  gear: string | undefined,
  _userId: string,
  page: PostManifestPage,
  postManifest: PostManifest,
  mlsGroup: ClientState,
  manifest: Manifest,
  manifestId: Uint8Array,
  store: LocalStore,
  remoteStore: RemoteStore,
  _messageClient: MessageClient,
  impl: CiphersuiteImpl,
  masterKey: Uint8Array
): Promise<[ClientState, PostManifestPage, PostManifest, Manifest]> {


  const currentPostSecret = await derivePostSecret(mlsGroup, impl)
  const payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }> = []

  const mainAlloc = allocateStorageIdentifier(currentPostSecret)
  const thumbnailAlloc = allocateStorageIdentifier(currentPostSecret)
  const mediaAllocs = media.map(() => allocateStorageIdentifier(currentPostSecret))

  payloads.push(
    { postSecret: currentPostSecret, storageId: mainAlloc.objectId, content },
    { postSecret: currentPostSecret, storageId: thumbnailAlloc.objectId, content: thumbnail },
    ...mediaAllocs.map((a, idx) => ({ postSecret: currentPostSecret, storageId: a.objectId, content: media[idx]! })),
  )

  const postMeta: PostMeta = {
    title,
    date,
    description,
    metrics,
    totalLikes: 0,
    sampleLikes: [],
    totalComments: 0,
    sampleComments: [],
    main: mainAlloc.storageIdentifier,
    comments: undefined,
    likes: undefined,
    media: mediaAllocs.map(a => a.storageIdentifier),
    thumbnail: thumbnailAlloc.storageIdentifier,
    type: postType,
    gear
  }


  // create MLS message of the post to group
  const msg: Message = { kind: "PostMessage", content: postMeta }

  const createMessageResult = await createApplicationMessage( { state: mlsGroup, message: encode(msg), context: { cipherSuite: impl, authService: unsafeTestingAuthenticationService }})

  let newPage: PostManifestPage
  let newPostManifest: PostManifest
  let newManifest: Manifest
  let indexPageIndexForPostLocator: number

  if (page.posts.length >= postLimit) {
    ;[newPage, newPostManifest, newManifest] = overflowManifestBatched(
      page,
      postManifest,
      manifest,
      manifestId,
      masterKey,
      postMeta,
      currentPostSecret,
      payloads,
    )

    indexPageIndexForPostLocator = page.pageIndex
  } else {
    ;[newPage, newPostManifest, newManifest] = addToPageBatched(
      page,
      postManifest,
      manifest,
      manifestId,
      masterKey,
      postMeta,
      currentPostSecret,
      payloads,
    )
    indexPageIndexForPostLocator = page.pageIndex
  }

  const [indexes, indexManifest] = await loadIndexes(newManifest, masterKey, remoteStore)
  const newCollection = addPostToIndexes(indexes, postMeta, indexPageIndexForPostLocator)
  collectIndexWrites(newCollection, masterKey, indexManifest, newManifest.indexes, payloads)

  await batchEncryptAndStoreWithSecrets(remoteStore, payloads)

  await store.storeGroupState(createMessageResult.newState)

  return [createMessageResult.newState, newPage, newPostManifest, newManifest]
}

function allocateStorageIdentifier(postSecret: Uint8Array): { objectId: Uint8Array; storageIdentifier: StorageIdentifier } {
  const objectId = crypto.getRandomValues(new Uint8Array(32))
  return {
    objectId,
    storageIdentifier: [uint8ToBase64Url(objectId), postSecret],
  }
}

function addToPageBatched(
  page: PostManifestPage,
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  currentPostSecret: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }>,
): [PostManifestPage, PostManifest, Manifest] {
  const newPage: PostManifestPage = {
    posts: [postMeta, ...page.posts],
    pageIndex: page.pageIndex,
  }

  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  const currentPageIdString = postManifest.currentPage[0]
  const newCurrentPage: StorageIdentifier = [currentPageIdString, currentPostSecret]

  const newPostManifest: PostManifest = {
    totals: updatedTotals,
    pages: postManifest.pages,
    currentPage: newCurrentPage,
  }

  const postManifestIdString = manifest.postManifest[0]
  const newManifest: Manifest = {
    ...manifest,
    postManifest: [postManifestIdString, currentPostSecret],
  }

  payloads.push(
    {
      postSecret: currentPostSecret,
      storageId: base64urlToUint8(currentPageIdString),
      content: encodePostManifestPage(newPage),
    },
    {
      postSecret: currentPostSecret,
      storageId: base64urlToUint8(postManifestIdString),
      content: encodePostManifest(newPostManifest),
    },
    {
      postSecret: masterKey,
      storageId: manifestId,
      content: encodeManifest(newManifest),
    },
  )

  return [newPage, newPostManifest, newManifest]
}

function overflowManifestBatched(
  page: PostManifestPage,
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  currentPostSecret: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }>,
): [PostManifestPage, PostManifest, Manifest] {
  const newPage: PostManifestPage = {
    posts: [postMeta],
    pageIndex: page.pageIndex + 1,
  }

  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  const newPageAlloc = allocateStorageIdentifier(currentPostSecret)

  const newPostManifest: PostManifest = {
    totals: updatedTotals,
    pages: [...postManifest.pages, { usedUntil: Date.now(), page: postManifest.currentPage }],
    currentPage: newPageAlloc.storageIdentifier,
  }

  const postManifestIdString = manifest.postManifest[0]
  const newManifest: Manifest = {
    ...manifest,
    postManifest: [postManifestIdString, currentPostSecret],
  }

  payloads.push(
    {
      postSecret: currentPostSecret,
      storageId: newPageAlloc.objectId,
      content: encodePostManifestPage(newPage),
    },
    {
      postSecret: currentPostSecret,
      storageId: base64urlToUint8(postManifestIdString),
      content: encodePostManifest(newPostManifest),
    },
    {
      postSecret: masterKey,
      storageId: manifestId,
      content: encodeManifest(newManifest),
    },
  )

  return [newPage, newPostManifest, newManifest]
}

function collectIndexWrites(
  indexes: IndexCollection,
  masterKey: Uint8Array,
  indexManifest: IndexManifest,
  indexManifestId: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }>,
): void {
  const newIndexManifest: IndexManifest = { ...indexManifest, typeMap: indexes.typeMap, gearMap: indexes.gearMap }

  payloads.push(
    { postSecret: masterKey, storageId: base64urlToUint8(indexManifest.byDistance), content: encode(indexes.byDistance) },
    { postSecret: masterKey, storageId: base64urlToUint8(indexManifest.byDuration), content: encode(indexes.byDuration) },
    { postSecret: masterKey, storageId: base64urlToUint8(indexManifest.byElevation), content: encode(indexes.byElevation) },
    { postSecret: masterKey, storageId: base64urlToUint8(indexManifest.byType), content: encode(indexes.byType) },
    { postSecret: masterKey, storageId: base64urlToUint8(indexManifest.byGear), content: encode(indexes.byGear) },
    { postSecret: masterKey, storageId: base64urlToUint8(indexManifest.wordIndex), content: encode(indexes.wordIndex) },
    { postSecret: masterKey, storageId: base64urlToUint8(indexManifest.postLocator), content: encode(indexes.postLocator) },
    { postSecret: masterKey, storageId: indexManifestId, content: encode(newIndexManifest) },
  )
}

async function loadIndexes(
  manifest: Manifest,
  masterKey: Uint8Array,
  remoteStore: RemoteStore
): Promise<[IndexCollection, IndexManifest]> {
  
  const decrypted = await retrieveAndDecryptContent(remoteStore, [uint8ToBase64Url(manifest.indexes), masterKey])
  
  const indexManifest = decode(new Uint8Array(decrypted)) as IndexManifest


  const [
    byDistanceData,
    byDurationData,
    byElevationData,
    byTypeData,
    byGearData,
    wordIndexData,
    postLocatorData
  ] = await Promise.all([
    retrieveAndDecryptContent(remoteStore, [indexManifest.byDistance, masterKey]),
    retrieveAndDecryptContent(remoteStore, [indexManifest.byDuration, masterKey]),
    retrieveAndDecryptContent(remoteStore, [indexManifest.byElevation, masterKey]),
    retrieveAndDecryptContent(remoteStore, [indexManifest.byType, masterKey]),
    retrieveAndDecryptContent(remoteStore, [indexManifest.byGear, masterKey]),
    retrieveAndDecryptContent(remoteStore, [indexManifest.wordIndex, masterKey]),
    retrieveAndDecryptContent(remoteStore, [indexManifest.postLocator, masterKey])
  ])

  const collection = {
    byDistance: decode(new Uint8Array(byDistanceData)) as IndexCollection["byDistance"],
    byDuration: decode(new Uint8Array(byDurationData)) as IndexCollection["byDuration"],
    byElevation: decode(new Uint8Array(byElevationData)) as IndexCollection["byElevation"],
    byType: decode(new Uint8Array(byTypeData)) as IndexCollection["byType"],
    byGear: decode(new Uint8Array(byGearData)) as IndexCollection["byGear"],
    wordIndex: decode(new Uint8Array(wordIndexData)) as IndexCollection["wordIndex"],
    postLocator: decode(new Uint8Array(postLocatorData)) as IndexCollection["postLocator"],
    typeMap: indexManifest.typeMap,
    gearMap: indexManifest.gearMap,
    version: 1
  }

  return [collection, indexManifest]
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
    newPageId = [pageId[0], currentPostSecret]

    const newPostManifest = replacePage(pageId, newPageId, postManifest)

    const payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }> = [
      {
        postSecret: currentPostSecret,
        storageId: base64urlToUint8(pageId[0]),
        content: encodePostManifestPage(newPage),
      },
      {
        postSecret: currentPostSecret,
        storageId: base64urlToUint8(manifest.postManifest[0]),
        content: encodePostManifest(newPostManifest),
      },
    ]

    let finalManifest: Manifest = manifest
    if (!compareUint8Arrays(currentPostSecret, manifest.postManifest[1])) {
      finalManifest = { ...manifest, postManifest: [manifest.postManifest[0], currentPostSecret] }
      payloads.push({
        postSecret: masterKey,
        storageId: manifestId,
        content: encodeManifest(finalManifest),
      })
    }

    await batchEncryptAndStoreWithSecrets(remoteStore, payloads)

    return [newPage, newPostManifest, finalManifest]
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


export async function encryptAndStoreWithPostSecret(postSecret: Uint8Array, remoteStore: RemoteStore, content: Uint8Array, storageId: Uint8Array): Promise<void> {
  const key = await importAesKey(postSecret)

  const nonce = crypto.getRandomValues(new Uint8Array(12))

  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    toBufferSource(content),
  )


  // store encrypted content remotely
  await remoteStore.storeContent(storageId, new Uint8Array(encryptedContent), nonce)
 
}

export async function batchEncryptAndStoreWithSecrets(
  remoteStore: RemoteStore,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }>,
): Promise<void> {
  const keyCache = new Map<string, CryptoKey>()

  const encryptedPayloads = await Promise.all(
    payloads.map(async ({ postSecret, storageId, content }) => {
      const cacheKey = uint8ToBase64Url(postSecret)
      let key = keyCache.get(cacheKey)
      if (!key) {
        key = await importAesKey(postSecret)
        keyCache.set(cacheKey, key)
      }

      const nonce = crypto.getRandomValues(new Uint8Array(12))
      const encryptedContent = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce },
        key,
        toBufferSource(content),
      )

      return { id: storageId, content: new Uint8Array(encryptedContent), nonce }
    }),
  )

  await remoteStore.batchStoreContent(encryptedPayloads)
}

export async function encryptAndStore(mlsGroup: ClientState, impl: CiphersuiteImpl, remoteStore: RemoteStore, content: Uint8Array, objectId?: Uint8Array): Promise<[string, Uint8Array]> {
  const { key, postSecret } = await deriveKeys(mlsGroup, impl)

  const nonce = crypto.getRandomValues(new Uint8Array(12))



  const encryptedContent = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    toBufferSource(content),
  )


  // store encrypted content remotely
  const storageId = await remoteStore.storeContent(objectId ?? crypto.getRandomValues(new Uint8Array(32)), new Uint8Array(encryptedContent), nonce)


  return [storageId, postSecret] as const
 
}

export async function deriveKeys(mlsGroup: ClientState, impl: CiphersuiteImpl): Promise<{ key: CryptoKey; postSecret: Uint8Array}> {
  const postSecret = await derivePostSecret(mlsGroup, impl)

  const key  = await crypto.subtle.importKey("raw", toBufferSource(postSecret), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])

  return {key, postSecret}
}

export async function importAesKey(postSecret: Uint8Array) {
  return await crypto.subtle.importKey("raw", toBufferSource(postSecret), { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])

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


