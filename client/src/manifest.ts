import { ClientState } from "ts-mls"

//First array is the objectId, second is the key
export type StorageIdentifier = [string, Uint8Array]


// use a new post manifest every time the master key is rotated

export interface PostManifest {
  posts: StorageIdentifier[]
}

export interface Post {
  content: Uint8Array
  name: string
  comments: StorageIdentifier[]
}

export interface Manifest {
  id: string
  currentPostManifest: CurrentPostManifest
  groupStateManifest: GroupStateManifest
  followeeManifests: Map<string, CurrentPostManifest>
}

export interface GroupStateManifest {
  groupStates: { groupId: Uint8Array; state: ClientState }[]
}

export interface DerivedMetrics {
  distance: number
  elevation: number
  duration: number
}

export interface PostMeta {
  title: string
  date: number
  metrics: DerivedMetrics
  totalLikes: number
  sampleLikes: Like[]
  totalComments: number
  sampleComments:Comment[]
  main: StorageIdentifier
  comments: StorageIdentifier | undefined
  likes: StorageIdentifier | undefined
}
//TODO should these be initalized with empty objects in storage instead?

//todo add commentId?
export interface Comment {
  postId: string
  author: string
  date: number
  text: string
  signature: Uint8Array
}

//todo add likeId?
export interface Like {
  postId: string
  author: string
  date: number
  signature: Uint8Array
}

export interface Totals {
  totalPosts: number
  totalDerivedMetrics: DerivedMetrics
}

export interface CurrentPostManifest {
  posts: PostMeta[]
  totals: Totals
  manifestIndex: number
  oldManifests: { usedUntil: number; postManifest: StorageIdentifier }[]
}


export function overflowManifest(manifest: CurrentPostManifest, storageId: StorageIdentifier): CurrentPostManifest {
  return {
    posts: [],
    totals: manifest.totals,
    manifestIndex: manifest.manifestIndex + 1,
    oldManifests: [...manifest.oldManifests, {usedUntil: Date.now(), postManifest: storageId}]
  }
}

export function upsertPost(manifest: CurrentPostManifest, meta: PostMeta): CurrentPostManifest {
  const index = manifest.posts.findIndex(pm => pm.main[0]== meta.main[0])

  if (index >= 0)
    return {
      ...manifest,
      posts: [...manifest.posts.slice(0, index), meta, ...manifest.posts.slice(index + 1, manifest.posts.length)]
    }
  else {
    const updatedTotals = {
      totalPosts: manifest.totals.totalPosts + 1,
      totalDerivedMetrics: addDerivedMetrics(manifest.totals.totalDerivedMetrics, meta.metrics),
    }
    return {
      ...manifest,
      totals: updatedTotals,
      posts: [...manifest.posts, meta]
    }
  }
}

function addDerivedMetrics(a: DerivedMetrics, b: DerivedMetrics): DerivedMetrics {
  return {
    distance: a.distance + b.distance,
    elevation: a.elevation + b.elevation,
    duration: a.duration + b.duration,
  }
}

// use a new post manifest every time the master key is rotated


