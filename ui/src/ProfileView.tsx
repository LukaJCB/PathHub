import {PostManifest, PostManifestPage, PostMeta, StorageIdentifier} from "pathhub-client/src/manifest.js"
import { Link, useParams } from "react-router";
import { useAuthRequired } from "./useAuth";
import { createRemoteStore, retrieveAndDecryptContent, retrieveAndDecryptPostManifestPage } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { useEffect, useState } from "react";
import { decodeBlobWithMime } from "pathhub-client/src/imageEncoding.js";


export const ProfileView: React.FC = () => {

    const {user} = useAuthRequired()
    const params = useParams();
    const page = parseInt(params.page!)
    const profileUserId = params.userId
    const [postManifestPage, setPostManifestPage] = useState<PostManifestPage | null>(null)
    useEffect(() => {
        const fetchData = async () => {
            if (user.id === profileUserId) {
                const [pmp, pmpId] = await getPage(user.currentPage, user.postManifest, page, user.token)
                console.log(pmp)
                setPostManifestPage(pmp)
            } else {
                //todo fetch post manifest page from profileUserId
            }
            
        }

       fetchData()
    }, [params])

    
    
    return (<>
        <h1>{user.name}</h1>
        
        <div>
            <h2>Totals</h2>
            <div>Total Posts: {user.postManifest.totals.totalPosts}</div>
            <div>Total Duration: {user.postManifest.totals.totalDerivedMetrics.duration / 3600000} hours</div>
            <div>Total Elevation: {user.postManifest.totals.totalDerivedMetrics.elevation} meters</div>
            <div>Total Distance: {user.postManifest.totals.totalDerivedMetrics.distance / 1000} kilometers</div>
        </div>
        {postManifestPage && (<>{postManifestPage.posts.map(post =>
            <PostPreview post={post} userId={user.id} page={page} token={user.token} key={post.main[0]}/>
        )}</>)}
        {page > 0 ? 
          <Link to={`/user/${user.id}/${page - 1}`} > {"<"} </Link> 
          : <></>
        }
        {page < user.currentPage.pageIndex ? 
          <Link to={`/user/${user.id}/${page + 1}`} > {">"} </Link> 
          : <></>
        }
        
        </>
    )
}

export async function getPage(currentPage: PostManifestPage, postManifest: PostManifest, pageNumber: number, token: string): Promise<[PostManifestPage, StorageIdentifier]> {
    const index = currentPage.pageIndex - pageNumber
    if (currentPage.pageIndex == index) {
        return [currentPage, postManifest.currentPage]
    } else {
        console.log(postManifest)
        console.log(index, postManifest.pages, pageNumber)
        const pageId = postManifest.pages[index].page

        const rs = await createRemoteStore(createContentClient("/storage", token))
        const page = await retrieveAndDecryptPostManifestPage(rs, pageId)
        return [page!, pageId]
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