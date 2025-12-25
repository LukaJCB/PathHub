import { PostManifestPage, PostMeta } from "./manifest"

export type Message =
  | { kind: "PostMessage"; content: PostMeta /*, newPostManifest: PostManifestPage | undefined */}
  | { kind: "FollowRequest"; keyPackage: Uint8Array }
  | { kind: "LikeMessage" }
