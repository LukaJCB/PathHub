import { PostMeta } from "./manifest"

export type Message =
  | { kind: "PostMessage"; content: PostMeta }
  | { kind: "FollowRequest"; keyPackage: Uint8Array }
  | { kind: "LikeMessage" }
