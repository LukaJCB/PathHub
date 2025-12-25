import { ClientState } from "ts-mls"

//First array is the objectId, second is the key
export type StorageIdentifier = [string, Uint8Array]


// use a new post manifest every time the master key is rotated


export interface Manifest {
  postManifest: StorageIdentifier
  groupStateManifest: Uint8Array
  followeeManifests: Map<string, StorageIdentifier>
  followRequests: Uint8Array
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
  thumbnail: StorageIdentifier
  media: StorageIdentifier[]
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

export interface PostManifestPage {
  posts: PostMeta[]
  pageIndex: number
}

export interface PostManifest {
  totals: Totals
  currentPage: StorageIdentifier
  pages: { usedUntil: number; page: StorageIdentifier }[]
}


export function addDerivedMetrics(a: DerivedMetrics, b: DerivedMetrics): DerivedMetrics {
  return {
    distance: a.distance + b.distance,
    elevation: a.elevation + b.elevation,
    duration: a.duration + b.duration,
  }
}

// use a new post manifest every time the master key is rotated


