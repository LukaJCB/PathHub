import {CurrentPostManifest, PostMeta} from "pathhub-client/src/manifest.js"
import { Link, useParams } from "react-router";
import { useAuthRequired } from "./useAuth";
import { createRemoteStore, retrieveAndDecryptContent, retrieveAndDecryptCurrentManifest } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { useEffect, useState } from "react";
import { decodeBlobWithMime } from "pathhub-client/src/imageEncoding.js";


export const ProfileView: React.FC = () => {

    const {user} = useAuthRequired()
    const params = useParams();
    const page = parseInt(params.page!)
    const profileUserId = params.userId
    const [postManifest, setPostManifest] = useState<CurrentPostManifest | null>(null)
    useEffect(() => {
        const fetchData = async () => {
            if (user.id === profileUserId) {
                const pm = await getPage(user.currentManifest, page, user.token)
                setPostManifest(pm)
            } else {
                //todo fetch currentManifest from profileUserId
            }
            
        }

       fetchData()
    }, [params])

    
    
    return (<>
        <h1>{user.name}</h1>
        
        <div>
            <h2>Totals</h2>
            <div>Total Posts: {user.currentManifest.totals.totalPosts}</div>
            <div>Total Duration: {user.currentManifest.totals.totalDerivedMetrics.duration / 3600000} hours</div>
            <div>Total Elevation: {user.currentManifest.totals.totalDerivedMetrics.elevation} meters</div>
            <div>Total Distance: {user.currentManifest.totals.totalDerivedMetrics.distance / 1000} kilometers</div>
        </div>
        {postManifest && (<>{postManifest.posts.map(post =>
            <PostPreview post={post} userId={user.id} page={page} token={user.token} key={post.main[0]}/>
        )}</>)}
        {page > 0 ? 
          <Link to={`/user/${user.id}/${page - 1}`} > {"<"} </Link> 
          : <></>
        }
        {page < user.currentManifest.manifestIndex ? 
          <Link to={`/user/${user.id}/${page + 1}`} > {">"} </Link> 
          : <></>
        }
        
        </>
    )
}

export async function getPage(pm: CurrentPostManifest, page: number, token: string): Promise<CurrentPostManifest> {
    const index = pm.manifestIndex - page
    if (pm.manifestIndex == index) {
        return pm
    } else {
        const pmId = pm.oldManifests[index].postManifest

        const rs = await createRemoteStore(createContentClient("/storage", token))
        const manifest = await retrieveAndDecryptCurrentManifest(rs, pmId)
        return manifest!
    }
}

type Props = {
    post: PostMeta
    userId: string
    page: number,
    token: string
}

const PostPreview: React.FC<Props> = ({post, userId, page, token}) => {

    const [thumb, setThumb] = useState<string | null>(null)


    useEffect(() => {
        const fetchData = async () => {
            const rs = await createRemoteStore(createContentClient("/storage", token))
            const result = await retrieveAndDecryptContent(rs, post.thumbnail)
            
            const { mimeType, bytes } = decodeBlobWithMime(new Uint8Array(result))
            const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
            const url = URL.createObjectURL(blob)

            setThumb(url)
        }

       fetchData()
       return () => {
          if (thumb) {
            URL.revokeObjectURL(thumb)
          }
       }
    }, [])
    
    return (<>
        <Link to={`/user/${userId}/${page}/${post.main[0]}`}><h2>{post.title}</h2></Link>
        <div> {new Date(post.date).toUTCString()}</div>
        <div> {post.totalLikes} likes</div>
        <div> {post.totalComments} comments</div>
        {thumb && (<img src={thumb} style={{ maxWidth: '300px' }} />)}
        <div>Duration: {post.metrics.duration / 3600000} hours</div>
        <div>Elevation: {post.metrics.elevation} meters</div>
        <div>Distance: {post.metrics.distance / 1000} kilometers</div>
    </>)
}

export default ProfileView