import { useAuthRequired } from "./useAuth"
import { createRemoteStore, RemoteStore } from "pathhub-client/src/remoteStore.js"
import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import { FormEvent, useEffect, useState } from "react"
import { allowFollow, requestFollow } from "pathhub-client/src/followRequest.js"
import { createCredential } from "pathhub-client/src/init.js"
import { createMessageClient, MessageClient } from "pathhub-client/src/http/messageClient.js"
import { decode } from "ts-mls"
import { createAuthenticationClient } from "pathhub-client/src/http/authenticationClient.js"
import { getUserInfo } from "pathhub-client/src/userInfo.js"
import { getAvatarImageUrl } from "./App"
import { Link } from "react-router"
import { keyPackageDecoder } from "ts-mls/keyPackage.js"

export const FollowRequestsView: React.FC = () => {
  const { user, updateUser } = useAuthRequired()
  const [userName, setUserName] = useState("")
  const [error, setError] = useState("")
  const [usernames, setUsernames] = useState<Map<string, string>>(new Map())
  const [avatars, setAvatars] = useState<Map<string, string>>(new Map())
  const messager: MessageClient = createMessageClient("/messaging", user.token)
  const remoteStore: RemoteStore = createRemoteStore(createContentClient("/storage", user.token))

  useEffect(() => {
    const fetchUserInfo = async () => {
      const authClient = createAuthenticationClient("/auth")
      const ids = new Set<string>()

      user.followRequests.incoming.forEach((i) => ids.add(i.followerId))
      user.followRequests.outgoing.forEach((i) => ids.add(i.followeeId))

      const usernamesMap = new Map<string, string>()
      const avatarsMap = new Map<string, string>()

      for (const id of ids) {
        const userInfo = await getUserInfo(id, remoteStore.client, authClient, user.token)
        if (userInfo.info) {
          usernamesMap.set(id, userInfo.info.username)
        }
        const avatar = getAvatarImageUrl(userInfo)
        if (avatar) {
          avatarsMap.set(id, avatar)
        }
      }

      setUsernames(usernamesMap)
      setAvatars(avatarsMap)
    }
    fetchUserInfo()
  }, [user.followRequests])

  async function acceptFollower(i: { followerId: string; keyPackage: Uint8Array }): Promise<void> {
    const kp = decode(keyPackageDecoder, i.keyPackage)!

    const [newFollowRequests, newGroup, newManifest, newPostManifest] = await allowFollow(
      i.followerId,
      user.id,
      kp,
      user.followRequests,
      user.currentPage,
      user.postManifest,
      user.manifest,
      user.ownGroupState,
      user.masterKey,
      remoteStore,
      messager,
      user.mlsContext,
    )
    updateUser({
      manifest: newManifest,
      postManifest: newPostManifest,
      followRequests: newFollowRequests,
      ownGroupState: newGroup,
    })
  }

  async function handleSubmitFollowRequest(e: FormEvent) {
    e.preventDefault()

    const authClient = createAuthenticationClient("/auth")
    const userInfo = await authClient.lookupUser(userName, user.token)

    if (userInfo) {
      const newFollowRequests = await requestFollow(
        createCredential(user.id),
        userInfo.userid,
        user.keyPair,
        user.followRequests,
        user.masterKey,
        messager,
        remoteStore,
        user.mlsContext.cipherSuite,
      )

      updateUser({ followRequests: newFollowRequests })
      setUserName("")
      setError("")
    } else {
      setError(`User "${userName}" not found. Please check the username and try again.`)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">Follow Requests</h1>

        <div className="space-y-8">
          {/* Inbound Requests */}
          <div className="bg-white rounded-lg shadow-md p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>📥</span> Inbound Requests ({user.followRequests.incoming.length})
            </h2>
            {user.followRequests.incoming.length > 0 ? (
              <div className="space-y-3">
                {user.followRequests.incoming.map((i) => (
                  <div
                    key={i.followerId}
                    className="flex items-center justify-between bg-gray-50 p-4 rounded-lg border border-gray-200"
                  >
                    <Link
                      to={`/user/${i.followerId}`}
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      {avatars.get(i.followerId) ? (
                        <img
                          src={avatars.get(i.followerId)}
                          alt="Avatar"
                          className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center font-semibold">
                          {(usernames.get(i.followerId) || i.followerId).slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="font-medium text-gray-900">{usernames.get(i.followerId) || i.followerId}</span>
                    </Link>
                    <button
                      onClick={() => acceptFollower(i)}
                      className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                    >
                      Accept
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No inbound requests</p>
            )}
          </div>

          {/* Outbound Requests */}
          <div className="bg-white rounded-lg shadow-md p-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <span>📤</span> Outbound Requests ({user.followRequests.outgoing.length})
            </h2>
            {user.followRequests.outgoing.length > 0 ? (
              <div className="space-y-3">
                {user.followRequests.outgoing.map((i) => (
                  <div key={i.followeeId} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <Link
                      to={`/user/${i.followeeId}`}
                      className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                    >
                      {avatars.get(i.followeeId) ? (
                        <img
                          src={avatars.get(i.followeeId)}
                          alt="Avatar"
                          className="w-10 h-10 rounded-full object-cover ring-2 ring-gray-200"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center font-semibold">
                          {(usernames.get(i.followeeId) || i.followeeId).slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <span className="font-medium text-gray-900 block">
                          {usernames.get(i.followeeId) || i.followeeId}
                        </span>
                        <p className="text-sm text-gray-500">Pending approval</p>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No outbound requests</p>
            )}
          </div>

          <div className="bg-white rounded-lg shadow-md p-8">
            <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
              <span>➕</span> Send Follow Request
            </h3>
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
                <span className="text-red-600 text-xl">⚠️</span>
                <p className="text-sm text-red-700 flex-1">{error}</p>
                <button
                  onClick={() => setError("")}
                  className="text-red-400 hover:text-red-600 transition-colors"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}
            <form onSubmit={(e) => handleSubmitFollowRequest(e)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">User Name</label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder="Enter user name"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                />
              </div>
              <button
                type="submit"
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
              >
                Send Request
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FollowRequestsView
