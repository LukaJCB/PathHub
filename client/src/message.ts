import { Interaction, PostMeta } from "./manifest"

export type Message =
  | { kind: "PostMessage"; content: PostMeta /*, newPostManifest: PostManifestPage | undefined */ }
  | { kind: "Interaction"; interaction: Interaction; posterId: string }

export type MessagePublic =
  | { kind: "FollowRequest"; keyPackage: Uint8Array }
  | { kind: "GroupMessage"; mlsMessage: Uint8Array }
