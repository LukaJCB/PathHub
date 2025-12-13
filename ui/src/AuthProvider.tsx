import { useState, ReactNode, useEffect } from "react";
import { AuthContext, User } from "./authContext.js";
import { AuthenticationClient, createAuthClient } from "pathhub-client/src/authClient.js";
import { makeStore } from "pathhub-client/src/indexedDbStore.js";
import { CurrentPostManifest } from "pathhub-client/src/manifest.js";
import {deriveGroupIdFromUserId} from "pathhub-client/src/mlsInteractions.js"
import {init} from "pathhub-client/src/init.js"
import { bytesToBase64 } from "ts-mls";
import { base64ToBytes } from "ts-mls/util/byteArray.js";
import { base64urlToUint8, createRemoteStore, retrieveAndDecryptCurrentManifest, uint8ToBase64Url } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const authClient: AuthenticationClient = createAuthClient("/auth")

  useEffect(() => {
    const setupState = async () => {
        const token = localStorage.getItem("auth_token");
        const manifestId = localStorage.getItem("manifest_id")
        const mkey = localStorage.getItem("master_key")
        if (!token || !manifestId || !mkey) return;

        const masterKey = base64urlToUint8(mkey)

        if (getExpFromToken(token) * 1000 <= Date.now()) return

        const { userId, username, manifest, groupState } = await setupUserState(token, manifestId, masterKey);
        

        setUser({id: userId, name: username, currentManifest: manifest, ownGroupState: groupState, currentManifestId: manifestId, masterKey, token })
    }
    setupState()
  }, [])

  async function login(username: string, password: string) {
    const res = await authClient.login({username, password})

    localStorage.setItem("auth_token", res.token)
    localStorage.setItem("manifest_id", res.manifest)
    localStorage.setItem("master_key", uint8ToBase64Url(res.masterKey))

    const { userId, manifest, groupState } = await setupUserState(res.token, res.manifest, res.masterKey)

    setUser({id: userId, name: username, currentManifest: manifest, ownGroupState: groupState, token: res.token, currentManifestId: res.manifest, masterKey: res.masterKey })
    
  }

  async function updateUser(updates: Partial<User>) {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  } 

  function logout() {
    setUser(null);
    localStorage.removeItem("auth_token");
    localStorage.removeItem("manifest_id");
    localStorage.removeItem("master_key")
    // todo clear state?
  }

  const value = { user, login, logout, updateUser };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}


async function setupUserState(token: string, manifestId: string, masterKey: Uint8Array) {
    const userId = getUserIdFromToken(token);

    const ls = await makeStore(userId);
    const rs = await createRemoteStore(createContentClient("/storage", token))
    
    const manifest = (await retrieveAndDecryptCurrentManifest(rs, manifestId, masterKey)) ?? {
        manifestIndex: 0,
        posts: [], oldManifests: [], totals: {
            totalPosts: 0,
            totalDerivedMetrics: {
                distance: 0,
                elevation: 0,
                duration: 0
            }
        }
    };

    console.log(manifest)
    console.log(manifestId)

    const groupId = await deriveGroupIdFromUserId(userId);

    // todo get groupstate from remote store
    const groupState = (await ls.getGroupState(bytesToBase64(groupId))) ?? await init(userId);

    const username = getUsernameFromToken(token);
    return { userId, username, manifest, groupState };
}

function parseToken(token: string): { userId: string, expires: number, username: string } {
  const decoded = base64ToBytes(token.split(".").at(1)!)
    const parsed = JSON.parse(new TextDecoder().decode(decoded))


    return {
      userId: parsed.sub,
      expires: parsed.expires,
      username: parsed["ph-user"]
    }
}

function getUserIdFromToken(token: string): string {
    const decoded = base64ToBytes(token.split(".").at(1)!)
    const parsed = JSON.parse(new TextDecoder().decode(decoded))


    return parsed.sub
}

function getExpFromToken(token: string): number {
    const decoded = base64ToBytes(token.split(".").at(1)!)
    const parsed = JSON.parse(new TextDecoder().decode(decoded))


    return parsed.exp
}

function getUsernameFromToken(token: string): string {
    const decoded = base64ToBytes(token.split(".").at(1)!)
    const parsed = JSON.parse(new TextDecoder().decode(decoded))


    return parsed["ph-user"]
}