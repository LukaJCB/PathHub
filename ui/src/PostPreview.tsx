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
    
    return (
        <Link to={`/user/${userId}/${page}/${post.main[0]}`} className="block hover:opacity-90 transition-opacity">
            <div className="bg-white rounded-lg shadow-md overflow-hidden hover:shadow-lg transition-shadow">
                {thumb && (
                    <div className="aspect-video w-full overflow-hidden bg-gray-200">
                        <img src={thumb} alt={post.title} className="w-full h-full object-cover" />
                    </div>
                )}
                
                <div className="p-4">
                    <h2 className="text-xl font-bold text-gray-900 mb-2 line-clamp-2">{post.title}</h2>
                    
                    <p className="text-xs text-gray-400 mb-2">by <span className="font-medium text-gray-600">{userId}</span></p>
                    
                    <p className="text-sm text-gray-500 mb-3">
                        {new Date(post.date).toLocaleDateString('en-US', { 
                            year: 'numeric', 
                            month: 'short', 
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                        })}
                    </p>
                    
                    <div className="grid grid-cols-3 gap-2 mb-4">
                        <div className="bg-blue-50 p-2 rounded text-center">
                            <div className="text-xs text-gray-600">Distance</div>
                            <div className="font-bold text-blue-600">{(post.metrics.distance / 1000).toFixed(1)} km</div>
                        </div>
                        <div className="bg-green-50 p-2 rounded text-center">
                            <div className="text-xs text-gray-600">Elevation</div>
                            <div className="font-bold text-green-600">{Math.round(post.metrics.elevation)} m</div>
                        </div>
                        <div className="bg-purple-50 p-2 rounded text-center">
                            <div className="text-xs text-gray-600">Duration</div>
                            <div className="font-bold text-purple-600">{(post.metrics.duration / 3600000).toFixed(1)} h</div>
                        </div>
                    </div>
                    
                    <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span className="flex items-center gap-1">
                                <span>👍</span>
                                <span>{post.totalLikes}</span>
                            </span>
                            <span className="flex items-center gap-1">
                                <span>💬</span>
                                <span>{post.totalComments}</span>
                            </span>
                        </div>
                    </div>
                </div>
            </div>
        </Link>
    )
}