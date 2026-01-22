import { PostManifestPage, Totals } from "pathhub-client/src/manifest.js"
import { Link, useParams } from "react-router"
import { useAuthRequired } from "./useAuth"
import { createRemoteStore } from "pathhub-client/src/remoteStore.js"
import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import { useEffect, useState } from "react"
import { getAllFollowees, getAllFollowers } from "pathhub-client/src/followRequest.js"
import { getPageForUser } from "pathhub-client/src/profile.js"
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls"
import { PostPreview } from "./PostPreview"
import { getAvatarImageUrl } from "./App"
import { getUserInfo } from "pathhub-client/src/userInfo.js"
import { createAuthenticationClient } from "pathhub-client/src/http/authenticationClient.js"

export const ProfileView: React.FC = () => {
  const { user } = useAuthRequired()
  const params = useParams()
  const page = params.page ? parseInt(params.page) : user.currentPage.pageIndex
  const profileUserId = params.userId!
  const [postManifestPage, setPostManifestPage] = useState<PostManifestPage | null>(null)
  const [canView, setCanView] = useState(true)
  const [avatar, setAvatar] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [followers, setFollowers] = useState(0)
  const [following, setFollowing] = useState<number | null>(null)
  const rs = createRemoteStore(createContentClient("/storage", user.token))
  useEffect(() => {
    const fetchData = async () => {
      const result = await getPageForUser(
        user.manifest,
        user.currentPage,
        user.postManifest,
        user.masterKey,
        user.id,
        profileUserId,
        page,
        user.ownGroupState,
        rs,
        await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")),
      )

      if (!result) {
        setCanView(false)
      } else {
        setTotals(result[1].totals)
        setPostManifestPage(result[0][0])
        if (user.id === profileUserId) {
          setFollowers(getAllFollowers(user.ownGroupState).length)
          setFollowing(getAllFollowees(user.manifest).length)
        } else {
          setFollowers(getAllFollowers(result[2]).length)
        }
        const userInfo = await getUserInfo(profileUserId, rs.client, createAuthenticationClient("/auth"), user.token)
        const avatar = profileUserId === user.id ? user.avatarUrl : getAvatarImageUrl(userInfo)
        const username = profileUserId === user.id ? user.name : userInfo.info?.username
        if (avatar) {
          setAvatar(avatar)
        }
        if (username) {
          setUsername(username)
        }
      }
    }

    fetchData()
  }, [params, user])

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : profileUserId.slice(0, 2).toUpperCase()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <div className="flex items-center gap-10 mb-6">
            <Link to={`/avatar`} aria-label="Edit profile picture" className="group relative inline-block">
              {avatar ? (
                <img
                  src={avatar}
                  alt="Avatar"
                  className="w-28 h-28 rounded-full object-cover ring-2 ring-indigo-100 group-hover:ring-indigo-400 transition"
                />
              ) : (
                <div className="w-28 h-28 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-4xl font-semibold">
                  {initials}
                </div>
              )}
              <span className="absolute inset-0 rounded-full bg-black/35 flex items-center justify-center text-white text-sm font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                Edit
              </span>
            </Link>
            <h1 className="text-4xl font-bold text-gray-900">{username}</h1>
          </div>

          {canView ? (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-gray-900 mb-4">Statistics</h2>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  {totals && (
                    <>
                      <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                        <div className="text-sm text-gray-600 mb-1">Total Posts</div>
                        <div className="text-3xl font-bold text-blue-600">{totals.totalPosts}</div>
                      </div>
                      <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
                        <div className="text-sm text-gray-600 mb-1">Total Distance</div>
                        <div className="text-3xl font-bold text-purple-600">
                          {(totals.totalDerivedMetrics.distance / 1000).toFixed(0)}
                        </div>
                        <div className="text-xs text-gray-500">km</div>
                      </div>
                      <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                        <div className="text-sm text-gray-600 mb-1">Total Elevation</div>
                        <div className="text-3xl font-bold text-green-600">
                          {Math.round(totals.totalDerivedMetrics.elevation)}
                        </div>
                        <div className="text-xs text-gray-500">m</div>
                      </div>
                      <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-4 rounded-lg border border-orange-200">
                        <div className="text-sm text-gray-600 mb-1">Total Duration</div>
                        <div className="text-3xl font-bold text-orange-600">
                          {(totals.totalDerivedMetrics.duration / 3600000).toFixed(0)}
                        </div>
                        <div className="text-xs text-gray-500">hours</div>
                      </div>
                    </>
                  )}
                  <div className="flex flex-col gap-2">
                    <Link
                      to={`/user/${profileUserId}/followers`}
                      className="bg-gradient-to-br from-pink-50 to-pink-100 p-4 rounded-lg border border-pink-200 text-center hover:shadow-md transition"
                    >
                      <div className="text-sm text-gray-600 mb-1">Followers</div>
                      <div className="text-3xl font-bold text-pink-600">{followers}</div>
                    </Link>
                    {following != null && (
                      <Link
                        to={`/following`}
                        className="bg-gradient-to-br from-cyan-50 to-cyan-100 p-4 rounded-lg border border-cyan-200 text-center hover:shadow-md transition"
                      >
                        <div className="text-sm text-gray-600 mb-1">Following</div>
                        <div className="text-3xl font-bold text-cyan-600">{following}</div>
                      </Link>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-6">Activities</h2>
                {postManifestPage && postManifestPage.posts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                    {postManifestPage.posts.map((post) => (
                      <PostPreview
                        post={post}
                        userId={profileUserId}
                        username={username!}
                        page={page}
                        token={user.token}
                        avatarUrl={avatar!}
                        key={post.main[0]}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">No activities yet</p>
                )}

                {/* Pagination */}
                <div className="flex items-center justify-center gap-4 mt-8">
                  {page < user.currentPage.pageIndex && (
                    <Link
                      to={`/user/${profileUserId}/${page + 1}`}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      ← Previous
                    </Link>
                  )}
                  <span className="text-gray-600 text-sm">
                    Page {user.currentPage.pageIndex - page + 1} of {user.currentPage.pageIndex + 1}
                  </span>
                  {page > 0 && (
                    <Link
                      to={`/user/${profileUserId}/${page - 1}`}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                    >
                      Next →
                    </Link>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-8 text-center">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">🔒 Profile Private</h3>
              <p className="text-gray-600 mb-6">You need to follow this user to see their activities.</p>
              {/*TODO this should just send the request instead of linking*/}
              <Link
                to="/followRequests"
                className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors"
              >
                Send Follow Request
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ProfileView
