//First is the objectId, second is the key
export type StorageIdentifier = [string, Uint8Array]

export type Versioned<T> = T & { version: bigint }

// use a new manifest every time the master key is rotated
export interface Manifest {
  postManifest: StorageIdentifier
  indexes: Uint8Array // reference to IndexManifest
  //todo should group states and follower manifests be combined?
  groupStates: Map<string, Uint8Array> //reference to FollowerGroupState
  followerManifests: Map<string, Uint8Array> //reference to FollowerManifest
  followRequests: Uint8Array // reference to FollowRequests
}

export interface FollowerGroupState {
  groupState: Uint8Array
  cachedInteractions: Map<string, Interaction[]>
}

//for every user you're following you should store their post manifest id&key as well as their current page id&key
//why do we need both? shouldn't the post manifest be enough?
export interface FollowerManifest {
  postManifest: StorageIdentifier
  currentPage: StorageIdentifier
}

export interface DerivedMetrics {
  distance: number
  elevation: number
  duration: number
}

//TODO should the post description be moved to inside main?
export interface PostMeta {
  title: string
  date: number
  description: string
  metrics: DerivedMetrics
  totalLikes: number
  sampleLikes: InteractionLike[]
  totalComments: number
  sampleComments: InteractionComment[]
  main: StorageIdentifier
  comments: StorageIdentifier | undefined
  likes: StorageIdentifier | undefined
  thumbnail: StorageIdentifier
  media: StorageIdentifier[]
  type: string | undefined
  gear: string | undefined
}

//TODO should these be initalized with empty objects in storage instead?

export interface BaseInteraction {
  postId: string
  author: string
  date: number
  signature: Uint8Array
}

export interface InteractionComment extends BaseInteraction {
  kind: "comment"
  text: string
}

export interface InteractionLike extends BaseInteraction {
  kind: "like"
}

export type InteractionType = "comment" | "like"

export type Interaction = InteractionComment | InteractionLike

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

export interface PostReference {
  postId: string
  sortValue: number
}

export interface PostLocatorEntry {
  pageIndex: number
  title: string
  date: number
  typeId?: number
  gearId?: number
  metrics: DerivedMetrics
}

export interface IndexManifest {
  byDistance: string
  byDuration: string
  byElevation: string
  byType: string
  byGear: string
  wordIndex: string
  postLocator: string
  typeMap: Map<number, string>
  gearMap: Map<number, string>
}

export interface ChunkedIndexManifest {
  chunkSize: number
  chunks: IndexChunkRef[]
}

export interface IndexChunkRef {
  min: number
  max: number
  ref: string
}

export interface IndexManifest2 {
  byDistance: ChunkedIndexManifest
  byDuration: ChunkedIndexManifest
  byElevation: ChunkedIndexManifest
  byType: ChunkedIndexManifest
  byGear: ChunkedIndexManifest
  wordIndex: ChunkedIndexManifest
  postLocator: ChunkedIndexManifest
  typeMap: Map<number, string>
  gearMap: Map<number, string>
}

//todo break down individual indexes into smaller ones once certain size is reached
export interface IndexCollection {
  byDistance: PostReference[]
  byDuration: PostReference[]
  byElevation: PostReference[]
  byType: Map<number, string[]>
  byGear: Map<number, string[]>
  wordIndex: Map<string, string[]>
  postLocator: Map<string, PostLocatorEntry>
  typeMap: Map<number, string> // typeId -> type name
  gearMap: Map<number, string> // gearId -> gear name
}

export function addDerivedMetrics(a: DerivedMetrics, b: DerivedMetrics): DerivedMetrics {
  return {
    distance: a.distance + b.distance,
    elevation: a.elevation + b.elevation,
    duration: a.duration + b.duration,
  }
}

// use a new post manifest every time the master key is rotated
