import { FollowRequests } from "pathhub-client/src/followRequest.js"
import { PostManifestPage, Manifest, PostManifest, Versioned } from "pathhub-client/src/manifest.js"
import { createContext } from "react"
import { ClientState } from "ts-mls"

export interface User {
  id: string
  name: string
  token: string
  manifest: Versioned<Manifest>
  manifestId: string
  postManifest: Versioned<PostManifest>
  currentPage: Versioned<PostManifestPage>
  ownGroupState: Versioned<ClientState>
  followRequests: Versioned<FollowRequests>
  masterKey: Uint8Array
  avatarUrl: string
}

export interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  updateUser: (updates: Partial<User>) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)
