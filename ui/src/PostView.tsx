import {Comment, PostManifestPage, PostMeta, StorageIdentifier} from "pathhub-client/src/manifest.js"
import { FormEvent, useEffect, useState } from "react";
import { useAuthRequired } from "./useAuth";
import { makeStore } from "pathhub-client/src/indexedDbStore.js";
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls";
import { useParams } from "react-router";
import { base64urlToUint8, createRemoteStore, retrieveAndDecryptContent, uint8ToBase64Url } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { commentPost, likePost, unlikePost } from "pathhub-client/src/postInteraction.js";
import { decodeComments, decodeLikes, decodeRoute } from "pathhub-client/src/codec/decode.js";
import { getPageForUser } from "pathhub-client/src/profile.js";
import { decodeBlobWithMime } from "pathhub-client/src/imageEncoding.js";
import MapLibreRouteMap from "./MapLibreView";


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
        return (<div> 
            <h3>Follow this user to see their profile</h3>
            <button>Request to Follow</button>
        </div>)
    }
    
    return (<>
        {post ? <><h2>{post.title}</h2>
        <div> {likes} likes</div>
        <div> {comments.length} comments</div>
        <div> {new Date(post.date).toUTCString()}</div>
        <div>Duration: {post.metrics.duration / 3600000} hours</div>
        <div>Elevation: {post.metrics.elevation} meters</div>
        <div>Distance: {post.metrics.distance / 1000} kilometers</div>
        </> : <></>}
        {gpxData ? <MapLibreRouteMap route={gpxData} showMarkers/> : <></>}
        {imageUrls && (
        <div>
          <h3>Media</h3>
          <ul>
            {imageUrls.map((url, idx) => (
              <li key={idx}>
                <img src={url} style={{ maxWidth: '300px' }} />
              </li>
            ))}
          </ul>
          
        </div>
      )}
        {userHasLiked ? <button onClick={removeLike}>Unlike</button> : <button onClick={addLike}>Like</button>}
        <ul>
            {comments.map(c => 
            <li key={uint8ToBase64Url(c.signature)}>{c.author} says: {c.text}</li>)}
        </ul>
        <form onSubmit={addComment}><textarea value={commentText} onChange={(e) => setCommentText(e.target.value)}></textarea>
        <input type="submit" value={"Add Comment"} />
        </form>

        </>
    )
}

export default PostView
