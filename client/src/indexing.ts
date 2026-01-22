import { decode } from "cbor-x"
import { IndexCollection, IndexManifest, Manifest, PostLocatorEntry, PostMeta, PostReference } from "./manifest.js"
import { RemoteStore, retrieveAndDecryptContent, uint8ToBase64Url } from "./remoteStore.js"

export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
}

export async function getWordIndex(
  manifest: Manifest,
  masterKey: Uint8Array,
  rs: RemoteStore,
): Promise<Map<string, string[]>> {
  const decrypted = await retrieveAndDecryptContent(rs, [uint8ToBase64Url(manifest.indexes), masterKey])

  const idxManifest = decode(new Uint8Array(decrypted)) as IndexManifest

  const decryptedIdx = await retrieveAndDecryptContent(rs, [idxManifest.wordIndex, masterKey])

  return decode(new Uint8Array(decryptedIdx)) as Map<string, string[]>
}

export async function getPostLocatorAndMaps(
  manifest: Manifest,
  masterKey: Uint8Array,
  rs: RemoteStore,
): Promise<[Map<string, PostLocatorEntry>, Map<number, string>, Map<number, string>]> {
  const decrypted = await retrieveAndDecryptContent(rs, [uint8ToBase64Url(manifest.indexes), masterKey])

  const idxManifest = decode(new Uint8Array(decrypted)) as IndexManifest

  const decryptedIdx = await retrieveAndDecryptContent(rs, [idxManifest.postLocator, masterKey])

  const postLocator = decode(new Uint8Array(decryptedIdx)) as Map<string, PostLocatorEntry>
  return [postLocator, idxManifest.typeMap, idxManifest.gearMap] as const
}

export async function getAllIndexes(
  manifest: Manifest,
  masterKey: Uint8Array,
  rs: RemoteStore,
): Promise<IndexCollection> {
  const manifestDecrypted = await retrieveAndDecryptContent(rs, [uint8ToBase64Url(manifest.indexes), masterKey])
  const idxManifest = decode(new Uint8Array(manifestDecrypted)) as IndexManifest

  const [
    byDistanceDecrypted,
    byDurationDecrypted,
    byElevationDecrypted,
    byTypeDecrypted,
    byGearDecrypted,
    wordIndexDecrypted,
    postLocatorDecrypted,
  ] = await Promise.all([
    retrieveAndDecryptContent(rs, [idxManifest.byDistance, masterKey]),
    retrieveAndDecryptContent(rs, [idxManifest.byDuration, masterKey]),
    retrieveAndDecryptContent(rs, [idxManifest.byElevation, masterKey]),
    retrieveAndDecryptContent(rs, [idxManifest.byType, masterKey]),
    retrieveAndDecryptContent(rs, [idxManifest.byGear, masterKey]),
    retrieveAndDecryptContent(rs, [idxManifest.wordIndex, masterKey]),
    retrieveAndDecryptContent(rs, [idxManifest.postLocator, masterKey]),
  ])

  return {
    byDistance: decode(new Uint8Array(byDistanceDecrypted)) as IndexCollection["byDistance"],
    byDuration: decode(new Uint8Array(byDurationDecrypted)) as IndexCollection["byDuration"],
    byElevation: decode(new Uint8Array(byElevationDecrypted)) as IndexCollection["byElevation"],
    byType: decode(new Uint8Array(byTypeDecrypted)) as IndexCollection["byType"],
    byGear: decode(new Uint8Array(byGearDecrypted)) as IndexCollection["byGear"],
    wordIndex: decode(new Uint8Array(wordIndexDecrypted)) as IndexCollection["wordIndex"],
    postLocator: decode(new Uint8Array(postLocatorDecrypted)) as IndexCollection["postLocator"],
    typeMap: idxManifest.typeMap,
    gearMap: idxManifest.gearMap,
  }
}

export function searchByTitle(
  wordIndex: Map<string, string[]>,
  postLocator: Map<string, PostLocatorEntry>,
  searchTerms: string,
): [PostLocatorEntry, string][] {
  const words = tokenizeTitle(searchTerms)
  if (!words[0]) return []

  const firstWord = words[0]
  let results = new Set(wordIndex.get(firstWord) || [])

  for (const word of words.slice(1)) {
    const postIds = new Set(wordIndex.get(word) || [])
    results = new Set([...results].filter((id) => postIds.has(id)))
  }

  const final: [PostLocatorEntry, string][] = []
  for (const result of results) {
    const post = postLocator.get(result)
    if (post) final.push([post, result])
  }

  return final
}

export function addPostToIndexes(indexes: IndexCollection, post: PostMeta, pageIndex: number): IndexCollection {
  const postId = getPostId(post)

  const distanceRef: PostReference = {
    postId,
    sortValue: post.metrics.distance,
  }
  const distanceInsertIndex = indexes.byDistance.findIndex((ref) => ref.sortValue < distanceRef.sortValue)
  if (distanceInsertIndex === -1) {
    indexes.byDistance.push(distanceRef)
  } else {
    indexes.byDistance.splice(distanceInsertIndex, 0, distanceRef)
  }

  const durationRef: PostReference = {
    postId,
    sortValue: post.metrics.duration,
  }
  const durationInsertIndex = indexes.byDuration.findIndex((ref) => ref.sortValue < durationRef.sortValue)
  if (durationInsertIndex === -1) {
    indexes.byDuration.push(durationRef)
  } else {
    indexes.byDuration.splice(durationInsertIndex, 0, durationRef)
  }

  const elevationRef: PostReference = {
    postId,
    sortValue: post.metrics.elevation,
  }
  const elevationInsertIndex = indexes.byElevation.findIndex((ref) => ref.sortValue < elevationRef.sortValue)
  if (elevationInsertIndex === -1) {
    indexes.byElevation.push(elevationRef)
  } else {
    indexes.byElevation.splice(elevationInsertIndex, 0, elevationRef)
  }

  let typeId: number | undefined
  if (post.type) {
    for (const [id, name] of indexes.typeMap) {
      if (name === post.type) {
        typeId = id
        break
      }
    }
    if (typeId === undefined) {
      typeId = indexes.typeMap.size + 1
      indexes.typeMap.set(typeId, post.type)
      indexes.byType.set(typeId, [postId])
    } else {
      indexes.byType.get(typeId)!.push(postId)
    }
  }

  let gearId: number | undefined
  if (post.gear) {
    for (const [id, name] of indexes.gearMap) {
      if (name === post.gear) {
        gearId = id
        break
      }
    }
    if (gearId === undefined) {
      gearId = indexes.gearMap.size + 1
      indexes.gearMap.set(gearId, post.gear)
      indexes.byGear.set(gearId, [postId])
    } else {
      indexes.byGear.get(gearId)!.push(postId)
    }
  }

  indexes.postLocator.set(postId, {
    pageIndex,
    title: post.title,
    date: post.date,
    typeId,
    gearId,
    metrics: post.metrics,
  })

  const words = tokenizeTitle(post.title)
  for (const word of words) {
    if (!indexes.wordIndex.has(word)) {
      indexes.wordIndex.set(word, [])
    }
    const postIds = indexes.wordIndex.get(word)!
    if (!postIds.includes(postId)) {
      postIds.push(postId)
    }
  }

  return indexes
}

function getPostId(post: PostMeta): string {
  return post.main[0]
}
