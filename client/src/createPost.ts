import { CiphersuiteImpl, createApplicationMessage, ClientState, unsafeTestingAuthenticationService } from "ts-mls"
import {
  PostManifestPage,
  DerivedMetrics,
  Manifest,
  PostManifest,
  PostMeta,
  StorageIdentifier,
  addDerivedMetrics,
  IndexCollection,
  IndexManifest,
  Versioned,
} from "./manifest"
import { encode } from "cbor-x"
import { MessageClient } from "./http/messageClient"

import { mlsExporter } from "ts-mls/keySchedule.js"
import { Message } from "./message"
import { addPostToIndexes, getAllIndexes } from "./indexing"

import { LocalStore } from "./localStore"
import { base64urlToUint8, RemoteStore, uint8ToBase64Url } from "./remoteStore"
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
  page: Versioned<PostManifestPage>,
  postManifest: Versioned<PostManifest>,
  mlsGroup: Versioned<ClientState>,
  manifest: Versioned<Manifest>,
  manifestId: Uint8Array,
  store: LocalStore,
  remoteStore: RemoteStore,
  _messageClient: MessageClient,
  impl: CiphersuiteImpl,
  masterKey: Uint8Array,
): Promise<[Versioned<ClientState>, Versioned<PostManifestPage>, Versioned<PostManifest>, Versioned<Manifest>]> {
  const currentPostSecret = await derivePostSecret(mlsGroup, impl)
  const payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint, debug: string }> = []

  console.log(page)
  const mainAlloc = allocateStorageIdentifier(currentPostSecret)
  const thumbnailAlloc = allocateStorageIdentifier(currentPostSecret)
  const mediaAllocs = media.map((content) => ({
    postSecret: currentPostSecret,
    storageId: crypto.getRandomValues(new Uint8Array(32)),
    content,
    version: 0n,
    debug: "media"
  }))

  payloads.push(
    { postSecret: currentPostSecret, storageId: mainAlloc.objectId, content, version: 0n, debug: "main" },
    { postSecret: currentPostSecret, storageId: thumbnailAlloc.objectId, content: thumbnail, version: 0n, debug: "thumb" },
    ...mediaAllocs,
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
    media: mediaAllocs.map((a) => [uint8ToBase64Url(a.storageId), a.postSecret]),
    thumbnail: thumbnailAlloc.storageIdentifier,
    type: postType,
    gear,
  }

  // create MLS message of the post to group
  const msg: Message = { kind: "PostMessage", content: postMeta }

  const createMessageResult = await createApplicationMessage({
    state: mlsGroup,
    message: encode(msg),
    context: { cipherSuite: impl, authService: unsafeTestingAuthenticationService },
  })

  let newPage: Versioned<PostManifestPage>
  let newPostManifest: Versioned<PostManifest>
  let newManifest: Versioned<Manifest>
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

  const [indexes, indexManifest] = await getAllIndexes(newManifest, masterKey, remoteStore)
  const newCollection = addPostToIndexes(indexes, postMeta, indexPageIndexForPostLocator)
  collectIndexWrites(newCollection, masterKey, indexManifest, newManifest.indexes, payloads)

  await batchEncryptAndStoreWithSecrets(remoteStore, payloads)

  await store.storeGroupState(createMessageResult.newState)

  return [{ ...createMessageResult.newState, version: mlsGroup.version + 1n }, newPage, newPostManifest, newManifest]
}

function allocateStorageIdentifier(postSecret: Uint8Array): {
  objectId: Uint8Array
  storageIdentifier: StorageIdentifier
} {
  const objectId = crypto.getRandomValues(new Uint8Array(32))
  return {
    objectId,
    storageIdentifier: [uint8ToBase64Url(objectId), postSecret],
  }
}

function addToPageBatched(
  page: Versioned<PostManifestPage>,
  postManifest: Versioned<PostManifest>,
  manifest: Versioned<Manifest>,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  currentPostSecret: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint, debug: string }>,
): [Versioned<PostManifestPage>, Versioned<PostManifest>, Versioned<Manifest>] {
  const newPage: Versioned<PostManifestPage> = {
    posts: [postMeta, ...page.posts],
    pageIndex: page.pageIndex,
    version: page.version + 1n,
  }

  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  const currentPageIdString = postManifest.currentPage[0]
  const newCurrentPage: StorageIdentifier = [currentPageIdString, currentPostSecret]

  const newPostManifest: Versioned<PostManifest> = {
    totals: updatedTotals,
    pages: postManifest.pages,
    currentPage: newCurrentPage,
    version: postManifest.version + 1n,
  }

  const postManifestIdString = manifest.postManifest[0]
  const newManifest: Versioned<Manifest> = {
    ...manifest,
    postManifest: [postManifestIdString, currentPostSecret],
    version: manifest.version + 1n,
  }

  payloads.push(
    {
      postSecret: currentPostSecret,
      storageId: base64urlToUint8(currentPageIdString),
      content: encodePostManifestPage(newPage),
      version: page.version,
      debug: "page"
    },
    {
      postSecret: currentPostSecret,
      storageId: base64urlToUint8(postManifestIdString),
      content: encodePostManifest(newPostManifest),
      version: postManifest.version,
      debug: "postm"
    },
    {
      postSecret: masterKey,
      storageId: manifestId,
      content: encodeManifest(newManifest),
      version: manifest.version,
      debug: "manifest"
    },
  )

  return [newPage, newPostManifest, newManifest]
}

function overflowManifestBatched(
  page: Versioned<PostManifestPage>,
  postManifest: Versioned<PostManifest>,
  manifest: Versioned<Manifest>,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  currentPostSecret: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint, debug: string }>,
): [Versioned<PostManifestPage>, Versioned<PostManifest>, Versioned<Manifest>] {
  const newPage: Versioned<PostManifestPage> = {
    posts: [postMeta],
    pageIndex: page.pageIndex + 1,
    version: 1n,
  }

  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  const newPageAlloc = allocateStorageIdentifier(currentPostSecret)

  const newPostManifest: Versioned<PostManifest> = {
    totals: updatedTotals,
    pages: [...postManifest.pages, { usedUntil: Date.now(), page: postManifest.currentPage }],
    currentPage: newPageAlloc.storageIdentifier,
    version: postManifest.version + 1n,
  }

  const postManifestIdString = manifest.postManifest[0]
  const newManifest: Versioned<Manifest> = {
    ...manifest,
    postManifest: [postManifestIdString, currentPostSecret],
    version: manifest.version + 1n,
  }

  payloads.push(
    {
      postSecret: currentPostSecret,
      storageId: newPageAlloc.objectId,
      content: encodePostManifestPage(newPage),
      version: 0n,
      debug: "page"
    },
    {
      postSecret: currentPostSecret,
      storageId: base64urlToUint8(postManifestIdString),
      content: encodePostManifest(newPostManifest),
      version: postManifest.version,
      debug: "postManifest"
    },
    {
      postSecret: masterKey,
      storageId: manifestId,
      content: encodeManifest(newManifest),
      version: manifest.version,
      debug: "manifest"
    },
  )

  return [newPage, newPostManifest, newManifest]
}

function collectIndexWrites(
  indexes: IndexCollection,
  masterKey: Uint8Array,
  indexManifest: Versioned<IndexManifest>,
  indexManifestId: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint, debug: string }>,
): void {
  const newIndexManifest: IndexManifest = { ...indexManifest, typeMap: indexes.typeMap, gearMap: indexes.gearMap }

  payloads.push(
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byDistance),
      content: encode(indexes.byDistance),
      version: indexManifest.version,
      debug: "idx1"
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byDuration),
      content: encode(indexes.byDuration),
      version: indexManifest.version,
       debug: "idx2"
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byElevation),
      content: encode(indexes.byElevation),
      version: indexManifest.version,
       debug: "idx3"
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byType),
      content: encode(indexes.byType),
      version: indexManifest.version,
      debug: "idx4"
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byGear),
      content: encode(indexes.byGear),
      version: indexManifest.version,
      debug: "idx5"
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.wordIndex),
      content: encode(indexes.wordIndex),
      version: indexManifest.version,
      debug: "idx6"
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.postLocator),
      content: encode(indexes.postLocator),
      version: indexManifest.version,
      debug: "idx7"
    },
    {
      postSecret: masterKey,
      storageId: indexManifestId,
      content: encode(newIndexManifest),
      version: indexManifest.version,
      debug: "idxMain"
    },
  )
}

export async function replaceInPage(
  mlsGroup: ClientState,
  impl: CiphersuiteImpl,
  page: Versioned<PostManifestPage>,
  pageId: StorageIdentifier,
  postManifest: Versioned<PostManifest>,
  manifest: Versioned<Manifest>,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  remoteStore: RemoteStore,
): Promise<[Versioned<PostManifestPage>, Versioned<PostManifest>, Versioned<Manifest>]> {
  const newPage = {
    posts: page.posts.map((pm) => {
      if (pm.main[0] === postMeta.main[0]) {
        return postMeta
      }
      return pm
    }),
    pageIndex: page.pageIndex,
    version: page.version + 1n,
  }

  let newPageId = pageId

  const currentPostSecret = await derivePostSecret(mlsGroup, impl)
  if (compareUint8Arrays(currentPostSecret, pageId[1])) {
    await encryptAndStoreWithPostSecret(
      currentPostSecret,
      remoteStore,
      encodePostManifestPage(newPage),
      base64urlToUint8(pageId[0]),
    )

    return [newPage, postManifest, manifest]
  } else {
    newPageId = [pageId[0], currentPostSecret]

    const newPostManifest = replacePage(pageId, newPageId, postManifest)

    const payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint, debug: string }> = [
      {
        postSecret: currentPostSecret,
        storageId: base64urlToUint8(pageId[0]),
        content: encodePostManifestPage(newPage),
        version: page.version,
        debug : "page"
      },
      {
        postSecret: currentPostSecret,
        storageId: base64urlToUint8(manifest.postManifest[0]),
        content: encodePostManifest(newPostManifest),
        version: postManifest.version,
         debug : "postma"
      },
    ]

    let finalManifest: Versioned<Manifest> = manifest
    if (!compareUint8Arrays(currentPostSecret, manifest.postManifest[1])) {
      finalManifest = {
        ...manifest,
        postManifest: [manifest.postManifest[0], currentPostSecret],
        version: manifest.version + 1n,
      }
      payloads.push({
        postSecret: masterKey,
        storageId: manifestId,
        content: encodeManifest(finalManifest),
        version: manifest.version,
         debug : "mani"
      })
    }

    await batchEncryptAndStoreWithSecrets(remoteStore, payloads)

    return [newPage, newPostManifest, finalManifest]
  }
}

function replacePage(
  oldPageId: StorageIdentifier,
  newPageId: StorageIdentifier,
  pm: Versioned<PostManifest>,
): Versioned<PostManifest> {
  if (pm.currentPage[0] === oldPageId[0]) {
    return { ...pm, currentPage: newPageId }
  }

  const newPages = pm.pages.map((p) => {
    if (p.page[0] === oldPageId[0]) {
      return { usedUntil: p.usedUntil, page: newPageId }
    }
    return p
  })

  return { ...pm, pages: newPages, version: pm.version + 1n }
}

//PostManifestPage -> postManifestIndex -> [PostManifestPage]

export async function encryptAndStoreWithPostSecret(
  postSecret: Uint8Array,
  remoteStore: RemoteStore,
  content: Uint8Array,
  storageId: Uint8Array,
): Promise<void> {
  const key = await importAesKey(postSecret)

  const nonce = crypto.getRandomValues(new Uint8Array(12))

  const encryptedContent = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, toBufferSource(content))

  // store encrypted content remotely
  await remoteStore.storeContent(storageId, new Uint8Array(encryptedContent), nonce)
}

export async function batchEncryptAndStoreWithSecrets(
  remoteStore: RemoteStore,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }>,
): Promise<void> {
  const keyCache = new Map<string, CryptoKey>()

  console.log(payloads)

  const encryptedPayloads = await Promise.all(
    payloads.map(async ({ postSecret, storageId, content, version }) => {
      const cacheKey = uint8ToBase64Url(postSecret)
      let key = keyCache.get(cacheKey)
      if (!key) {
        key = await importAesKey(postSecret)
        keyCache.set(cacheKey, key)
      }

      const nonce = crypto.getRandomValues(new Uint8Array(12))
      const encryptedContent = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, toBufferSource(content))

      return { id: storageId, content: new Uint8Array(encryptedContent), nonce, version }
    }),
  )

  await remoteStore.batchStoreContent(encryptedPayloads)
}

export async function encryptAndStore(
  mlsGroup: ClientState,
  impl: CiphersuiteImpl,
  remoteStore: RemoteStore,
  content: Uint8Array,
  version: bigint,
  objectId?: Uint8Array,
): Promise<[string, Uint8Array]> {
  const { key, postSecret } = await deriveKeys(mlsGroup, impl)

  const nonce = crypto.getRandomValues(new Uint8Array(12))

  const encryptedContent = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, toBufferSource(content))

  // store encrypted content remotely
  const storageId = await remoteStore.storeContent(
    objectId ?? crypto.getRandomValues(new Uint8Array(32)),
    new Uint8Array(encryptedContent),
    nonce,
    version,
  )

  return [storageId, postSecret] as const
}

export async function deriveKeys(
  mlsGroup: ClientState,
  impl: CiphersuiteImpl,
): Promise<{ key: CryptoKey; postSecret: Uint8Array }> {
  const postSecret = await derivePostSecret(mlsGroup, impl)

  const key = await crypto.subtle.importKey("raw", toBufferSource(postSecret), { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ])

  return { key, postSecret }
}

export async function importAesKey(postSecret: Uint8Array) {
  return await crypto.subtle.importKey("raw", toBufferSource(postSecret), { name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ])
}

export async function derivePostSecret(mlsGroup: ClientState, impl: CiphersuiteImpl): Promise<Uint8Array> {
  return await mlsExporter(mlsGroup.keySchedule.exporterSecret, "data encryption key", new Uint8Array(), 32, impl)
}

function compareUint8Arrays(arr1: Uint8Array, arr2: Uint8Array): boolean {
  if (arr1.length !== arr2.length) {
    return false
  }

  for (let i = 0; i < arr1.length; i++) {
    if (arr1[i] !== arr2[i]) {
      return false
    }
  }

  return true
}
