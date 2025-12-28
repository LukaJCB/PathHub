import { createContentClient } from "pathhub-client/src/http/storageClient.js"
import { decodeBlobWithMime } from "pathhub-client/src/imageEncoding.js"
import { PostMeta } from "pathhub-client/src/manifest.js"
import { createRemoteStore, retrieveAndDecryptContent } from "pathhub-client/src/remoteStore.js"
import { useEffect, useState } from "react"
import { Link } from "react-router"

type Props = {
    post: PostMeta
    userId: string
    page: number,
    token: string
}

export const PostPreview: React.FC<Props> = ({post, userId, page, token}) => {

    const [thumb, setThumb] = useState<string | null>(null)
    const rs = createRemoteStore(createContentClient("/storage", token))

    useEffect(() => {
        const fetchData = async () => {
            
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