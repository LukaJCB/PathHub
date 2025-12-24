import { CurrentPostManifest, Manifest } from "pathhub-client/src/manifest.js";
import { createContext } from "react";
import {ClientState} from "ts-mls"

export interface User {
  id: string
  name: string
  token: string
  manifest: Manifest
  manifestId: string
  currentManifest: CurrentPostManifest
  ownGroupState: ClientState
  masterKey: Uint8Array
}

export interface AuthContextValue {
  user: User | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void
}

export const AuthContext = createContext<AuthContextValue | null>(null);

