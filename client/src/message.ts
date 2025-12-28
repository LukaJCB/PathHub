
import { PostMeta } from "./manifest"

export type Message =
  | { kind: "PostMessage"; content: PostMeta /*, newPostManifest: PostManifestPage | undefined */}
  | { kind: "LikeMessage" }


export type MessagePublic = 
  | { kind: "FollowRequest"; keyPackage: Uint8Array }
  | { kind: "GroupMessage"; mlsMessage: Uint8Array }
