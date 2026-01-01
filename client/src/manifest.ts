
//First is the objectId, second is the key
export type StorageIdentifier = [string, Uint8Array]


// use a new manifest every time the master key is rotated
export interface Manifest {
  postManifest: StorageIdentifier
  //todo should group states and follower manifests be combined?
  groupStates: Map<string, Uint8Array>
  followerManifests: Map<string, Uint8Array>
  followRequests: Uint8Array
}

export interface FollowerGroupState {
  groupState: Uint8Array,
  cachedInteractions: Map<string, Interaction[]>
}


//for every user you're following you should store their post manifest id&key as well as their current page id&key
//why do we need both? shouldn't the post manifest be enough?
export interface FollowerManifest {
  postManifest: StorageIdentifier,
  currentPage: StorageIdentifier
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
  sampleLikes: InteractionLike[]
  totalComments: number
  sampleComments: InteractionComment[]
  main: StorageIdentifier
  comments: StorageIdentifier | undefined
  likes: StorageIdentifier | undefined
  thumbnail: StorageIdentifier
  media: StorageIdentifier[]
  type: string | undefined,
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


export function addDerivedMetrics(a: DerivedMetrics, b: DerivedMetrics): DerivedMetrics {
  return {
    distance: a.distance + b.distance,
    elevation: a.elevation + b.elevation,
    duration: a.duration + b.duration,
  }
}

// use a new post manifest every time the master key is rotated


