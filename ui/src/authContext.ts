import { FollowRequests } from "pathhub-client/src/followRequest.js"
import { SignatureKeyPair } from "pathhub-client/src/init.js"
import { PostManifestPage, Manifest, PostManifest, Entity, FollowerGroupState } from "pathhub-client/src/manifest.js"
import { createContext } from "react"
import { MlsContext } from "ts-mls"

export interface User {
  id: string
  name: string
  token: string
  manifest: Entity<Manifest>
  postManifest: Entity<PostManifest>
  currentPage: Entity<PostManifestPage>
  ownGroupState: Entity<FollowerGroupState>
  followRequests: Entity<FollowRequests>
  masterKey: Uint8Array
  avatarUrl: string
  keyPair: SignatureKeyPair
  mlsContext: MlsContext
}

export interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  updateUser: (updates: Partial<User>) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
