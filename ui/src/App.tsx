import { useEffect, useState } from 'react'
import LeafletRouteMap from './LeafleftMapView.js';
import FileUpload from './FileUploader.js';
import { useAuth, useAuthRequired } from './useAuth.js';
import ProfileView from './ProfileView.js';
import { Link } from 'react-router';
import { BulkImport } from './Import.js';
import {getTimeline, TimelineItem} from "pathhub-client/src/timeline.js"
import { createContentClient } from 'pathhub-client/src/http/storageClient.js';
import { createRemoteStore } from 'pathhub-client/src/remoteStore.js';
import { getCiphersuiteFromName, getCiphersuiteImpl } from 'ts-mls';
import { PostMeta } from 'pathhub-client/src/manifest.js';
import { PostPreview } from './PostPreview.js';


function App() {
  const {user} = useAuthRequired()
  const [posts, setPosts] = useState<TimelineItem[]>([])
  const rs = createRemoteStore(createContentClient("/storage", user.token))

  useEffect(() => {
    const fetchData = async () => {
      const posts = await getTimeline(user.manifest, user.id, user.currentPage, user.masterKey, rs, await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))
      setPosts(posts)
    }
    fetchData()
  }, [])

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
            {posts.map(post =>
              <PostPreview post={post.post} userId={post.userId} page={post.page} token={user.token} key={post.post.main[0]}/>
            )}
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
  );
}

export default App
