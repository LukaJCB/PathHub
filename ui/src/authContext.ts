import { FollowRequests } from "pathhub-client/src/followRequest.js";
import { PostManifestPage, Manifest, PostManifest } from "pathhub-client/src/manifest.js";
import { createContext } from "react";
import {ClientState} from "ts-mls"

export interface User {
  id: string
  name: string
  token: string
  manifest: Manifest
  manifestId: string
  postManifest: PostManifest
  currentPage: PostManifestPage
  ownGroupState: ClientState
  followRequests: FollowRequests
  masterKey: Uint8Array
  avatarUrl: string
}

export interface AuthContextValue {
  user: User | null;
  loading: boolean
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null);

