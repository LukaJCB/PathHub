import { useEffect, useState } from 'react'
import LeafletRouteMap from './LeafleftMapView.js';
import FileUpload from './FileUploader.js';
import { useAuth, useAuthRequired } from './useAuth.js';
import ProfileView from './ProfileView.js';
import { Link } from 'react-router';
import { ZipExtractor } from './Import.js';
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
    <>
      <ZipExtractor />
      <div><Link to={`/user/${user.id}/0`} > {user.name} </Link></div>
      <div><Link to="/followRequests">Follow Requests</Link></div>
      <div><Link to="/upload">Click here to Upload an Activity!</Link></div>
      <li>
        {posts.map(post =>
            <PostPreview post={post.post} userId={post.userId} page={post.page} token={user.token} key={post.post.main[0]}/>
        )}
      </li>
    </>
  );
}

export default App
