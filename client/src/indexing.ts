import { decode } from "cbor-x"
import { IndexCollection, IndexManifest, Manifest, PostLocatorEntry, PostMeta, PostReference } from "./manifest.js"
import { RemoteStore, retrieveAndDecryptContent, uint8ToBase64Url } from "./remoteStore.js"

export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
}

export async function getWordIndex(manifest: Manifest, masterKey: Uint8Array, rs: RemoteStore): Promise<Map<string, string[]>> {
  const decrypted = await retrieveAndDecryptContent(rs, [uint8ToBase64Url(manifest.indexes), masterKey])

  const idxManifest = decode(new Uint8Array(decrypted)) as IndexManifest
  
  const decryptedIdx = await retrieveAndDecryptContent(rs, [idxManifest.wordIndex, masterKey])
  
  return decode(new Uint8Array(decryptedIdx))
}

export async function getPostLocatorAndMaps(manifest: Manifest, masterKey: Uint8Array, rs: RemoteStore): Promise<[Map<string, PostLocatorEntry>, Map<number, string>, Map<number, string>]> {
  const decrypted = await retrieveAndDecryptContent(rs, [uint8ToBase64Url(manifest.indexes), masterKey])

  const idxManifest = decode(new Uint8Array(decrypted)) as IndexManifest
  
  const decryptedIdx = await retrieveAndDecryptContent(rs, [idxManifest.postLocator, masterKey])
  console.log(decryptedIdx.byteLength)
  
  const postLocator: Map<string, PostLocatorEntry> = decode(new Uint8Array(decryptedIdx))
  return [postLocator, idxManifest.typeMap, idxManifest.gearMap] as const
}

export function searchByTitle(
  wordIndex: Map<string, string[]>,
  postLocator: Map<string, PostLocatorEntry>,
  searchTerms: string
): [PostLocatorEntry, string][] {
  const words = tokenizeTitle(searchTerms)
  if (!words[0]) return []


  const firstWord = words[0]
  let results = new Set(wordIndex.get(firstWord) || [])


    for (const word of words.slice(1)) {
    const postIds = new Set(wordIndex.get(word) || [])
    results = new Set([...results].filter(id => postIds.has(id)))
  }

  const final: [PostLocatorEntry, string][] = []
  for (const result of results) {
    const post = postLocator.get(result)
    if (post) final.push([post, result])
  }

  return final
}

export function getPostsByDistance(
  indexes: IndexCollection,
  limit?: number
): PostReference[] {
  return limit ? indexes.byDistance.slice(0, limit) : indexes.byDistance
}

export function getPostsByType(
  indexes: IndexCollection,
  type: string,
  limit?: number
): string[] {

  let typeId: number | undefined
  for (const [id, name] of indexes.typeMap) {
    if (name === type) {
      typeId = id
      break
    }
  }
  
  if (typeId === undefined) return []
  
  const ids = indexes.byType.get(typeId) || []
  return limit ? ids.slice(0, limit) : ids
}


export function getPostsByDuration(
  indexes: IndexCollection,
  limit?: number
): PostReference[] {
  return limit ? indexes.byDuration.slice(0, limit) : indexes.byDuration
}

export function getPostsByElevation(
  indexes: IndexCollection,
  limit?: number
): PostReference[] {
  return limit ? indexes.byElevation.slice(0, limit) : indexes.byElevation
}


export function getPostsByGear(
  indexes: IndexCollection,
  gear: string,
  limit?: number
): string[] {

  let gearId: number | undefined
  for (const [id, name] of indexes.gearMap) {
    if (name === gear) {
      gearId = id
      break
    }
  }
  
  if (gearId === undefined) return []
  
  const ids = indexes.byGear.get(gearId) || []
  return limit ? ids.slice(0, limit) : ids
}

export function getAvailableTypes(indexes: IndexCollection): string[] {
  return Array.from(indexes.typeMap.values())
}

export function getAvailableGear(indexes: IndexCollection): string[] {
  return Array.from(indexes.gearMap.values())
}

export function addPostToIndexes(
  indexes: IndexCollection,
  post: PostMeta,
  pageIndex: number
): IndexCollection {
  const postId = getPostId(post)


  const distanceRef: PostReference = {
    postId,
    sortValue: post.metrics.distance,
  }
  const distanceInsertIndex = indexes.byDistance.findIndex(
    ref => ref.sortValue < distanceRef.sortValue
  )
  if (distanceInsertIndex === -1) {
    indexes.byDistance.push(distanceRef)
  } else {
    indexes.byDistance.splice(distanceInsertIndex, 0, distanceRef)
  }


  const durationRef: PostReference = {
    postId,
    sortValue: post.metrics.duration,
  }
  const durationInsertIndex = indexes.byDuration.findIndex(
    ref => ref.sortValue < durationRef.sortValue
  )
  if (durationInsertIndex === -1) {
    indexes.byDuration.push(durationRef)
  } else {
    indexes.byDuration.splice(durationInsertIndex, 0, durationRef)
  }


  const elevationRef: PostReference = {
    postId,
    sortValue: post.metrics.elevation,
  }
  const elevationInsertIndex = indexes.byElevation.findIndex(
    ref => ref.sortValue < elevationRef.sortValue
  )
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

  indexes.version = Date.now()
  return indexes
}


function getPostId(post: PostMeta): string {
  return post.main[0]
}
