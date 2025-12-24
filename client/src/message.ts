import { CurrentPostManifest, PostMeta } from "./manifest"

export type Message =
  | { kind: "PostMessage"; content: PostMeta /*, newPostManifest: CurrentPostManifest | undefined */}
  | { kind: "FollowRequest"; keyPackage: Uint8Array }
  | { kind: "LikeMessage" }
