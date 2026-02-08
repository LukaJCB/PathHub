import { CiphersuiteImpl, createApplicationMessage, ClientState, MlsContext } from "ts-mls"
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
  Entity,
  createPayloadRaw,
  getStorageIdentifier,
  newEntity,
  updateEntity,
  FollowerGroupState,
} from "./manifest"
import { encode } from "cbor-x"
import { MessageClient } from "./http/messageClient"

import { mlsExporter } from "ts-mls"
import { Message } from "./message"
import { addPostToIndexes, getAllIndexes } from "./indexing"

import { base64urlToUint8, RemoteStore, uint8ToBase64Url } from "./remoteStore"
import { toBufferSource } from "ts-mls"
import {
  encodePostManifestPage,
  encodeManifest,
  encodePostManifest,
  encodeExtraInstruction,
  encodeFollowerGroupState,
} from "./codec/encode"

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
  page: Entity<PostManifestPage>,
  postManifest: Entity<PostManifest>,
  mlsGroup: Entity<FollowerGroupState>,
  manifest: Entity<Manifest>,
  remoteStore: RemoteStore,
  _messageClient: MessageClient,
  mls: MlsContext,
  masterKey: Uint8Array,
  postLimit = 10,
): Promise<[Entity<FollowerGroupState>, Entity<PostManifestPage>, Entity<PostManifest>, Entity<Manifest>]> {
  const currentPostSecret = await derivePostSecret(mlsGroup.groupState, mls.cipherSuite)
  const payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }> = []

  console.log(page)

  const mainAlloc = createPayloadRaw(content, currentPostSecret)
  const thumbnailAlloc = createPayloadRaw(thumbnail, currentPostSecret)
  const mediaAllocs = media.map((content) => createPayloadRaw(content, currentPostSecret))

  payloads.push(mainAlloc, thumbnailAlloc, ...mediaAllocs)

  const postMeta: PostMeta = {
    title,
    date,
    description,
    metrics,
    totalLikes: 0,
    sampleLikes: [],
    totalComments: 0,
    sampleComments: [],
    main: getStorageIdentifier(mainAlloc),
    comments: undefined,
    likes: undefined,
    media: mediaAllocs.map((a) => [uint8ToBase64Url(a.storageId), a.postSecret]),
    thumbnail: getStorageIdentifier(thumbnailAlloc),
    type: postType,
    gear,
  }

  // create MLS message of the post to group
  const msg: Message = { kind: "PostMessage", content: postMeta }

  const createMessageResult = await createApplicationMessage({
    state: mlsGroup.groupState,
    message: encode(msg),
    context: mls,
  })

  const [newGroupStatePayload, newGroupState] = updateEntity(
    mlsGroup,
    { ...mlsGroup, groupState: createMessageResult.newState },
    encodeFollowerGroupState,
    masterKey,
  )

  console.log(newGroupStatePayload)
  console.log(newGroupState)
  payloads.push(newGroupStatePayload)

  let newPage: Entity<PostManifestPage>
  let newPostManifest: Entity<PostManifest>
  let newManifest: Entity<Manifest>
  let indexPageIndexForPostLocator: number

  if (page.posts.length >= postLimit) {
    ;[newPage, newPostManifest, newManifest] = overflowManifestBatched(
      page,
      postManifest,
      manifest,
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

  return [newGroupState, newPage, newPostManifest, newManifest]
}

function addToPageBatched(
  page: Entity<PostManifestPage>,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  currentPostSecret: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }>,
): [Entity<PostManifestPage>, Entity<PostManifest>, Entity<Manifest>] {
  const [newPagePayload, newPage] = updateEntity(
    page,
    {
      posts: [postMeta, ...page.posts],
      pageIndex: page.pageIndex,
    },
    encodePostManifestPage,
    currentPostSecret,
  )

  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  const [newPostManifestPayload, newPostManifest] = updateEntity<PostManifest>(
    postManifest,
    {
      totals: updatedTotals,
      pages: postManifest.pages,
      currentPage: newPage.storage,
    },
    encodePostManifest,
    currentPostSecret,
  )

  const postManifestIdString = manifest.postManifest[0]

  const [newManifestPayload, newManifest] = updateEntity<Manifest>(
    manifest,
    {
      ...manifest,
      postManifest: [postManifestIdString, currentPostSecret],
    },
    encodeManifest,
    masterKey,
  )

  payloads.push(newPagePayload, newPostManifestPayload, newManifestPayload)

  return [newPage, newPostManifest, newManifest]
}

function overflowManifestBatched(
  page: Entity<PostManifestPage>,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  postMeta: PostMeta,
  currentPostSecret: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }>,
): [Entity<PostManifestPage>, Entity<PostManifest>, Entity<Manifest>] {
  const [newPagePayload, newPage] = newEntity<PostManifestPage>(
    {
      posts: [postMeta],
      pageIndex: page.pageIndex + 1,
    },
    currentPostSecret,
    encodePostManifestPage,
  )

  const updatedTotals = {
    totalPosts: postManifest.totals.totalPosts + 1,
    totalDerivedMetrics: addDerivedMetrics(postManifest.totals.totalDerivedMetrics, postMeta.metrics),
  }

  const [newPostManifestPayload, newPostManifest] = updateEntity(
    postManifest,
    {
      totals: updatedTotals,
      pages: [...postManifest.pages, { usedUntil: Date.now(), page: postManifest.currentPage }],
      currentPage: getStorageIdentifier(newPagePayload),
    },
    encodePostManifest,
    currentPostSecret,
  )

  const postManifestIdString = manifest.postManifest[0]
  const [newManifestPayload, newManifest] = updateEntity<Manifest>(
    manifest,
    {
      ...manifest,
      postManifest: [postManifestIdString, currentPostSecret],
    },
    encodeManifest,
  )

  payloads.push(newPagePayload, newPostManifestPayload, newManifestPayload)

  return [newPage, newPostManifest, newManifest]
}

function collectIndexWrites(
  indexes: IndexCollection,
  masterKey: Uint8Array,
  indexManifest: Entity<IndexManifest>,
  indexManifestId: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }>,
): void {
  const newIndexManifest: IndexManifest = { ...indexManifest, typeMap: indexes.typeMap, gearMap: indexes.gearMap }

  payloads.push(
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byDistance),
      content: encode(indexes.byDistance),
      version: indexManifest.version,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byDuration),
      content: encode(indexes.byDuration),
      version: indexManifest.version,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byElevation),
      content: encode(indexes.byElevation),
      version: indexManifest.version,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byType),
      content: encode(indexes.byType),
      version: indexManifest.version,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byGear),
      content: encode(indexes.byGear),
      version: indexManifest.version,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.wordIndex),
      content: encode(indexes.wordIndex),
      version: indexManifest.version,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.postLocator),
      content: encode(indexes.postLocator),
      version: indexManifest.version,
    },
    {
      postSecret: masterKey,
      storageId: indexManifestId,
      content: encode(newIndexManifest),
      version: indexManifest.version,
    },
  )
}

export async function replaceInPage(
  mlsGroup: ClientState,
  mls: MlsContext,
  page: Entity<PostManifestPage>,
  pageId: StorageIdentifier,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  masterKey: Uint8Array,
  postMeta: PostMeta,
  remoteStore: RemoteStore,
): Promise<[Entity<PostManifestPage>, Entity<PostManifest>, Entity<Manifest>]> {
  const currentPostSecret = await derivePostSecret(mlsGroup, mls.cipherSuite)
  const [newPagePayload, newPage] = updateEntity(
    page,
    {
      posts: page.posts.map((pm) => {
        if (pm.main[0] === postMeta.main[0]) {
          return postMeta
        }
        return pm
      }),
      pageIndex: page.pageIndex,
    },
    encodePostManifestPage,
    currentPostSecret,
  )

  if (compareUint8Arrays(currentPostSecret, pageId[1])) {
    await batchEncryptAndStoreWithSecrets(remoteStore, [newPagePayload])

    return [newPage, postManifest, manifest]
  } else {
    const newPageId: StorageIdentifier = [pageId[0], currentPostSecret]

    const [newPostManifestPayload, newPostManifest] = updateEntity<PostManifest>(
      postManifest,
      replacePage(pageId, newPageId, postManifest),
      encodePostManifest,
      currentPostSecret,
    )

    const payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }> = [
      newPagePayload,
      newPostManifestPayload,
    ]

    let finalManifest: Entity<Manifest> = manifest
    if (!compareUint8Arrays(currentPostSecret, manifest.postManifest[1])) {
      const [manifestPayload, newManifest] = updateEntity(
        manifest,
        {
          ...manifest,
          postManifest: [manifest.postManifest[0], currentPostSecret],
        },
        encodeManifest,
        masterKey,
      )

      finalManifest = newManifest
      payloads.push(manifestPayload)
    }

    await batchEncryptAndStoreWithSecrets(remoteStore, payloads)

    return [newPage, newPostManifest, finalManifest]
  }
}

function replacePage(oldPageId: StorageIdentifier, newPageId: StorageIdentifier, pm: PostManifest): PostManifest {
  if (pm.currentPage[0] === oldPageId[0]) {
    return { ...pm, currentPage: newPageId }
  }

  const newPages = pm.pages.map((p) => {
    if (p.page[0] === oldPageId[0]) {
      return { usedUntil: p.usedUntil, page: newPageId }
    }
    return p
  })

  return { ...pm, pages: newPages }
}

//PostManifestPage -> postManifestIndex -> [PostManifestPage]

export async function encryptAndStoreWithPostSecret(
  postSecret: Uint8Array,
  remoteStore: RemoteStore,
  content: Uint8Array,
  storageId: Uint8Array,
  version: bigint,
): Promise<void> {
  const key = await importAesKey(postSecret)

  const nonce = crypto.getRandomValues(new Uint8Array(12))

  const encryptedContent = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, toBufferSource(content))

  // store encrypted content remotely
  await remoteStore.storeContent(storageId, new Uint8Array(encryptedContent), nonce, version)
}

export interface ExtraInstruction {
  kind: "addFollower"
  ids: string[]
}

export async function batchEncryptAndStoreWithSecrets(
  remoteStore: RemoteStore,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }>,
  extra?: ExtraInstruction,
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
  const extraInstruction = extra ? encodeExtraInstruction(extra) : new Uint8Array()

  await remoteStore.batchStoreContent(encryptedPayloads, extraInstruction)
}

export async function encryptAndStore(
  mlsGroup: ClientState,
  mls: MlsContext,
  remoteStore: RemoteStore,
  content: Uint8Array,
  version: bigint,
  objectId?: Uint8Array,
): Promise<[string, Uint8Array]> {
  const { key, postSecret } = await deriveKeys(mlsGroup, mls.cipherSuite)

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
