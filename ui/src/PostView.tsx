import {Comment, PostManifestPage, PostMeta, StorageIdentifier} from "pathhub-client/src/manifest.js"
import { FormEvent, useEffect, useState } from "react";
import { useAuthRequired } from "./useAuth";
import { makeStore } from "pathhub-client/src/indexedDbStore.js";
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls";
import { Link, useParams } from "react-router";
import { base64urlToUint8, createRemoteStore, retrieveAndDecryptContent, uint8ToBase64Url } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { commentPost, likePost, unlikePost } from "pathhub-client/src/postInteraction.js";
import { decodeComments, decodeLikes, decodeRoute } from "pathhub-client/src/codec/decode.js";
import { getPageForUser } from "pathhub-client/src/profile.js";
import { decodeBlobWithMime } from "pathhub-client/src/imageEncoding.js";
import MapLibreRouteMap from "./MapLibreView";
import { getAvatarImageUrl } from "./App";


export const PostView = () => {

    const {user, updateUser} = useAuthRequired()
    const params = useParams()
    const storageId = params.storageId
    const page = parseInt(params.page!)
    const profileUserId = params.userId!
    const rs = createRemoteStore(createContentClient("/storage", user.token))
    const [canView, setCanView] = useState(true)
    const [post, setPost] = useState<PostMeta | null>(null)
    const [postManifestPage, setPostManifestPage] = useState<[PostManifestPage, StorageIdentifier] | null>(null)
    const [imageUrls, setImageUrls] = useState<string[]>([])
    const [comments, setComments] = useState<Comment[]>([])
    const [likes, setLikes] = useState(0)
    const [userHasLiked, setUserHasLiked] = useState(false)
    const [gpxData, setGpxData] = useState<[number, number, number][] | null>(null)
    const [commentText, setCommentText] = useState("")
    const [avatar, setAvatar] = useState<string | null>(null)
    
    useEffect(() => {
        if (!storageId) throw new Error("no storage id")
        const fetchData = async () => {

            const result = await getPageForUser(user.manifest, user.currentPage, user.postManifest, user.masterKey,
                user.id, profileUserId, page, rs, 
                await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"))
            )

            if (!result) {
                setCanView(false)
            } else {
                const currentPage = result
                setPostManifestPage(currentPage)

                const p = currentPage[0].posts.find(pm => pm.main[0] === storageId)
                setPost(p!)

                const l = p?.likes
                const c = p?.comments

                const media = p!.media.map(m => retrieveAndDecryptContent(rs, m))

                const [fetchedPost, likes, comments, ...fetchedMedia] = await Promise.all([
                    retrieveAndDecryptContent(rs, p!.main),
                    l ? retrieveAndDecryptContent(rs, l) : Promise.resolve(undefined),
                    c ? retrieveAndDecryptContent(rs, c) : Promise.resolve(undefined),
                    ...media
                ])

                const urls = fetchedMedia.map((i) => {
                    const { mimeType, bytes } = decodeBlobWithMime(new Uint8Array(i))
                    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
                    return URL.createObjectURL(blob);
                });

                setImageUrls(urls)

                setGpxData(decodeRoute(new Uint8Array(fetchedPost)))
                if (comments) setComments(decodeComments(new Uint8Array(comments)))

                if (likes) {
                    const ls = decodeLikes(new Uint8Array(likes))
                    setUserHasLiked(ls.some(l => l.author === user.id))
                }
                
                setLikes(p!.totalLikes)
                const avatar = profileUserId === user.id ? user.avatarUrl : await getAvatarImageUrl(profileUserId, rs.client)
                setAvatar(avatar)
            }
           
        }
        fetchData()
        return () => {
          imageUrls.forEach(URL.revokeObjectURL);
        };
    }, [])


    async function addComment(e: FormEvent) {
        e.preventDefault()
        const isOwnPost = profileUserId === user.id

        const {newManifest, comment} = await commentPost(commentText, post!, 
            (await crypto.subtle.generateKey("Ed25519", false, ["sign"])).privateKey, //todo
             user.ownGroupState, isOwnPost, user.id, rs, 
             postManifestPage![0], 
             postManifestPage![1],
             user.postManifest,
             user.manifest,
             base64urlToUint8(user.manifestId),
             user.masterKey,
             await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))

        setComments([...comments, comment])
        setCommentText("")
        
        if (newManifest) {
            const [manifest, postManifest, page, post] = newManifest
            setPost(post)
            updateUser({currentPage: page, manifest, postManifest})
        }
        
    }

    async function addLike() {

        const isOwnPost = profileUserId === user.id
        setLikes(likes + 1)
        setUserHasLiked(true)
        const {newManifest, like} = await likePost(post!, 
            (await crypto.subtle.generateKey("Ed25519", false, ["sign"])).privateKey, //todo
             user.ownGroupState, isOwnPost, user.id, rs, 
             postManifestPage![0], 
             postManifestPage![1],
             user.postManifest,
             user.manifest,
             base64urlToUint8(user.manifestId),
             user.masterKey,
             await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))

        
        if (newManifest) {
            const [manifest, postManifest, page, post] = newManifest
            setPost(post)
            updateUser({currentPage: page, manifest, postManifest})
        }
    }

    async function removeLike() {
        const isOwnPost = profileUserId === user.id

        setLikes(likes - 1)
        setUserHasLiked(false)
        const {newManifest} = await unlikePost(post!, 
             user.ownGroupState, isOwnPost, user.id, rs, 
             postManifestPage![0], 
             postManifestPage![1],
             user.postManifest,
             user.manifest,
             base64urlToUint8(user.manifestId),
             user.masterKey,
             await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))


        
        if (newManifest) {
            const [manifest, postManifest, page, post] = newManifest
            setPost(post)
            updateUser({currentPage: page, manifest, postManifest})
        }
    }

    if (!canView) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
                <div className="bg-white rounded-lg shadow-md p-8 max-w-md w-full text-center">
                    <h3 className="text-xl font-semibold text-gray-900 mb-4">🔒 Profile Private</h3>
                    <p className="text-gray-600 mb-6">You need to follow this user to see their posts.</p>
                </div>
            </div>
        )
    }
    
    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-md overflow-hidden">
                    {/* Post Header */}
                    {post && (
                        <div className="p-8 border-b border-gray-200">
                            <h2 className="text-3xl font-bold text-gray-900 mb-4">{post.title}</h2>
                            <Link 
                                to={`/user/${profileUserId}/0`} 
                                aria-label="Open profile"
                                className="flex items-center gap-3 mb-4 hover:opacity-80"
                            >
                                {avatar ? (
                                    <img 
                                        src={avatar} 
                                        alt="Avatar" 
                                        className="w-9 h-9 rounded-full object-cover ring-2 ring-indigo-100"
                                    />
                                ) : (
                                    <div className="w-9 h-9 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center font-semibold">
                                        {profileUserId.slice(0,2).toUpperCase()}
                                    </div>
                                )}
                                <p className="text-xs text-gray-500">by <span className="font-medium text-gray-700">{profileUserId}</span></p>
                            </Link>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                                <div className="bg-blue-50 p-3 rounded-lg">
                                    <div className="text-xs text-gray-600 mb-1">Distance</div>
                                    <div className="text-lg font-bold text-blue-600">{(post.metrics.distance / 1000).toFixed(1)} km</div>
                                </div>
                                <div className="bg-green-50 p-3 rounded-lg">
                                    <div className="text-xs text-gray-600 mb-1">Elevation</div>
                                    <div className="text-lg font-bold text-green-600">{Math.round(post.metrics.elevation)} m</div>
                                </div>
                                <div className="bg-purple-50 p-3 rounded-lg">
                                    <div className="text-xs text-gray-600 mb-1">Duration</div>
                                    <div className="text-lg font-bold text-purple-600">{(post.metrics.duration / 3600000).toFixed(1)} h</div>
                                </div>
                                <div className="bg-gray-50 p-3 rounded-lg">
                                    <div className="text-xs text-gray-600 mb-1">Date</div>
                                    <div className="text-lg font-bold text-gray-600">{new Date(post.date).toLocaleDateString('en-US', { 
                                        year: 'numeric', 
                                        month: 'short', 
                                        day: 'numeric',
                                        hour: '2-digit',
                                        minute: '2-digit'
                                    })}</div>
                                </div>
                            </div>

                            <div className="flex items-center gap-6 text-sm text-gray-600">
                                <span className="flex items-center gap-1">
                                    <span>👍</span>
                                    <span className="font-semibold">{likes}</span>
                                </span>
                                <span className="flex items-center gap-1">
                                    <span>💬</span>
                                    <span className="font-semibold">{comments.length}</span>
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Map */}
                    {gpxData && (
                        <div className="relative w-full h-96 bg-gray-200 border-b border-gray-200 overflow-hidden">
                            <MapLibreRouteMap route={gpxData} showMarkers/>
                        </div>
                    )}

                    {/* Media Gallery */}
                    {imageUrls && imageUrls.length > 0 && (
                        <div className="p-8 border-b border-gray-200">
                            <h3 className="text-lg font-semibold text-gray-900 mb-4">📸 Photos</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                                {imageUrls.map((url, idx) => (
                                    <div key={idx} className="aspect-square rounded-lg overflow-hidden border border-gray-200 shadow-sm hover:shadow-md transition">
                                        <img src={url} alt={`Photo ${idx + 1}`} className="w-full h-full object-cover" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Like Button */}
                    <div className="p-8 border-b border-gray-200">
                        {userHasLiked ? (
                            <button 
                                onClick={removeLike}
                                className="w-full px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 font-semibold rounded-lg transition-colors border border-red-200"
                            >
                                👍 Unlike
                            </button>
                        ) : (
                            <button 
                                onClick={addLike}
                                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                            >
                                👍 Like
                            </button>
                        )}
                    </div>

                    {/* Comments Section */}
                    <div className="p-8">
                        <h3 className="text-lg font-semibold text-gray-900 mb-6">Comments</h3>
                        
                        {comments.length > 0 ? (
                            <div className="space-y-4 mb-8">
                                {comments.map(c => (
                                    <div key={uint8ToBase64Url(c.signature)} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                        <div className="font-semibold text-gray-900">{c.author}</div>
                                        <p className="text-gray-600 mt-1">{c.text}</p>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p className="text-gray-500 text-center py-4 mb-8">No comments yet</p>
                        )}

                        {/* Add Comment Form */}
                        <div className="border-t border-gray-200 pt-6">
                            <h4 className="text-md font-semibold text-gray-900 mb-4">Add a Comment</h4>
                            <form onSubmit={addComment} className="space-y-3">
                                <textarea 
                                    value={commentText} 
                                    onChange={(e) => setCommentText(e.target.value)}
                                    placeholder="Share your thoughts..."
                                    rows={4}
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition resize-none"
                                />
                                <button 
                                    type="submit" 
                                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                                >
                                    Post Comment
                                </button>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default PostView
