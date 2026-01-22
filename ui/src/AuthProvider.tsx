import { useState, ReactNode, useEffect } from "react"
import { AuthContext, User } from "./authContext.js"
import { AuthenticationClient, createAuthClient, parseToken } from "pathhub-client/src/authClient.js"
import { getOrCreateManifest } from "pathhub-client/src/init.js"
import {
  base64urlToUint8,
  createRemoteStore,
  retrieveAndDecryptContent,
  uint8ToBase64Url,
} from "pathhub-client/src/remoteStore.js"
import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import { getAvatarImageUrl } from "./App.js"
import { getUserInfo } from "pathhub-client/src/userInfo.js"
import { createAuthenticationClient } from "pathhub-client/src/http/authenticationClient.js"
import { decodeFollowRequests } from "pathhub-client/src/codec/decode.js"

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null)

  const [loading, setLoading] = useState(true)
  const authClient: AuthenticationClient = createAuthClient("/auth")

  useEffect(() => {
    const setupState = async () => {
      const token = localStorage.getItem("auth_token")
      const manifestId = localStorage.getItem("manifest_id")
      const mkey = localStorage.getItem("master_key")
      if (token && manifestId && mkey) {
        const masterKey = base64urlToUint8(mkey)
        //todo don't parse token twice
        const { expires } = parseToken(token)

        if (expires * 1000 > Date.now()) {
          const { userId, username, manifest, postManifest, page, followRequests, groupState, avatarUrl } =
            await setupUserState(token, manifestId, masterKey)

          setUser({
            id: userId,
            name: username,
            currentPage: page,
            postManifest,
            manifest,
            manifestId,
            followRequests,
            ownGroupState: groupState,
            masterKey,
            token,
            avatarUrl: avatarUrl!,
          })
        }
      }

      setLoading(false)
    }
    setupState()
  }, [])

  async function login(username: string, password: string) {
    const res = await authClient.login({ username, password })

    localStorage.setItem("auth_token", res.token)
    localStorage.setItem("manifest_id", res.manifest)
    localStorage.setItem("master_key", uint8ToBase64Url(res.masterKey))

    const { userId, manifest, postManifest, page, followRequests, groupState, avatarUrl } = await setupUserState(
      res.token,
      res.manifest,
      res.masterKey,
    )

    setUser({
      id: userId,
      name: username,
      currentPage: page,
      postManifest,
      followRequests,
      manifest,
      manifestId: res.manifest,
      ownGroupState: groupState,
      token: res.token,
      masterKey: res.masterKey,
      avatarUrl: avatarUrl!,
    })
  }

  async function updateUser(updates: Partial<User>) {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev))
  }

  function logout() {
    setUser(null)
    localStorage.removeItem("auth_token")
    localStorage.removeItem("manifest_id")
    localStorage.removeItem("master_key")
    // todo clear state?
  }

  const value = { user, login, logout, loading, updateUser }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

async function setupUserState(token: string, manifestId: string, masterKey: Uint8Array) {
  const { userId, username } = parseToken(token)
  const rs = createRemoteStore(createContentClient("/storage", token))

  const [manifest, postManifest, page, groupState, keyPair] = await getOrCreateManifest(
    userId,
    manifestId,
    masterKey,
    rs,
  )
  const result = await retrieveAndDecryptContent(rs, [uint8ToBase64Url(manifest.followRequests), masterKey])
  const followRequests = decodeFollowRequests(new Uint8Array(result))
  const userInfo = await getUserInfo(userId, rs.client, createAuthenticationClient("/auth"), token)
  const avatarUrl = getAvatarImageUrl(userInfo)

  return {
    userId,
    username,
    manifest,
    postManifest,
    page,
    followRequests,
    groupState,
    keyPair,
    avatarUrl,
  }
}
