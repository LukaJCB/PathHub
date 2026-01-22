import { useEffect, useState } from "react"
import { useAuthRequired } from "./useAuth.js"
import { Link } from "react-router"
import { getTimeline, TimelineItem } from "pathhub-client/src/timeline.js"
import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import { createRemoteStore } from "pathhub-client/src/remoteStore.js"
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls"
import { getUserInfo, UserInfo } from "pathhub-client/src/userInfo.js"
import { PostPreview } from "./PostPreview.js"
import { bytesToArrayBuffer } from "ts-mls/util/byteArray.js"
import { createAuthenticationClient } from "pathhub-client/src/http/authenticationClient.js"

export function getAvatarImageUrl(userInfo: UserInfo): string | undefined {
  const { avatar } = userInfo

  if (avatar?.contentType === "image/svg+xml") {
    const decoded = new TextDecoder().decode(avatar.body)
    const imageUrl = `data:image/svg+xml;utf8,${encodeURIComponent(decoded)}`
    return imageUrl
  } else if (avatar?.contentType === "image/png" || avatar?.contentType === "image/jpeg") {
    const blob = new Blob([bytesToArrayBuffer(avatar.body)], {
      type: avatar.contentType,
    })
    const url = URL.createObjectURL(blob)

    return url
  }
}

function App() {
  const { user } = useAuthRequired()
  const [posts, setPosts] = useState<TimelineItem[]>([])
  const [avatars, setAvatars] = useState<Map<string, string>>(new Map())
  const [userNames, setUserNames] = useState<Map<string, string>>(new Map())
  const rs = createRemoteStore(createContentClient("/storage", user.token))

  useEffect(() => {
    const fetchData = async () => {
      const posts = await getTimeline(
        user.manifest,
        user.id,
        user.currentPage,
        user.masterKey,
        rs,
        await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")),
      )
      setPosts(posts)

      console.log(posts)

      const authors: Set<string> = new Set()
      posts.forEach((p) => authors.add(p.userId))

      const avatars = new Map<string, string>()
      const usernames = new Map<string, string>()
      for (const author of authors) {
        const userInfo = await getUserInfo(author, rs.client, createAuthenticationClient("/auth"), user.token)
        const avatar = getAvatarImageUrl(userInfo)
        if (avatar) {
          avatars.set(author, avatar)
        }
        if (userInfo.info) {
          usernames.set(author, userInfo.info.username)
        }
      }
      setAvatars(avatars)
      setUserNames(usernames)
    }
    fetchData()
  }, [user])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between bg-white rounded-lg shadow-md p-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Feed</h1>
              <p className="text-gray-600 mt-1">Latest activities from people you follow</p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/followRequests"
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg transition-colors"
              >
                Follow Requests
              </Link>
              <Link
                to="/upload"
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
              >
                + Upload Activity
              </Link>
            </div>
          </div>
        </div>

        {posts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {posts.map((post) => (
              <PostPreview
                post={post.post}
                userId={post.userId}
                username={userNames.get(post.userId)}
                page={post.page}
                token={user.token}
                avatarUrl={avatars.get(post.userId)}
                key={post.post.main[0]}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md p-12 text-center">
            <p className="text-gray-500 text-lg mb-4">No activities yet</p>
            <p className="text-gray-400 mb-6">Start by uploading an activity or following other users!</p>
            <Link
              to="/upload"
              className="inline-block px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
            >
              Upload Your First Activity
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
