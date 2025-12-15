import {Comment, CurrentPostManifest, PostManifest, PostMeta} from "pathhub-client/src/manifest.js"
import { FormEvent, useEffect, useState } from "react";
import { useAuthRequired } from "./useAuth";
import { makeStore } from "pathhub-client/src/indexedDbStore.js";
import { mlsExporter } from "ts-mls/keySchedule.js";
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls";
import LeafletRouteMap from "./LeafleftMapView";
import { useParams } from "react-router";
import { createRemoteStore, RemoteStore, retrieveAndDecryptContent, uint8ToBase64Url } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { base64ToBytes } from "ts-mls/util/byteArray.js";
import { decode } from "cbor-x";
import { commentPost, likePost } from "pathhub-client/src/postInteraction.js";
import { decodeRoute } from "pathhub-client/src/codec/decode.js";


type Props = {
  post: PostMeta;
};

export const PostView = () => {

    const {user, updateUser} = useAuthRequired()
    let {storageId} = useParams()
    const [post, setPost] = useState<PostMeta | null>(null)
    const [comments, setComments] = useState<Comment[]>([])
    const [likes, setLikes] = useState<number>(0)
    const [gpxData, setGpxData] = useState<[number, number, number][] | null>(null)
    const [commentText, setCommentText] = useState("")
    
    useEffect(() => {
        if (storageId === null) throw new Error("no storage id")
        const fetchData = async () => {
            const ls = await makeStore(user.id)
            const rs = await createRemoteStore(createContentClient("/storage", user.token))

            const p = user.currentManifest.posts.find(pm => pm.main[0] === storageId)
            setPost(p!)

            const l = p?.likes
            const c = p?.comments

            const [fetchedPost, comments] = await Promise.all([
                retrieveAndDecryptContent(rs, p!.main),
                c ? retrieveAndDecryptContent(rs, c) : Promise.resolve(undefined)
            ])

            setGpxData(decodeRoute(new Uint8Array(fetchedPost)))
            if (comments) setComments(decode(new Uint8Array(comments)))
            
            setLikes(p!.totalLikes)
           
        }
        fetchData()
    }, [])


    async function addComment(e: FormEvent) {
        e.preventDefault()

        
        const rs = await createRemoteStore(createContentClient("/storage", user.token))
        const {newManifest, comment} = await commentPost(commentText, post!, 
            (await crypto.subtle.generateKey("Ed25519", false, ["sign"])).privateKey, //todo
             user.ownGroupState, true, user.name, rs, 
             user.currentManifest,
             user.manifest.currentPostManifest, //todo need to insert the post secret here too!!
             await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))

        setComments([...comments, comment])
        setCommentText("")
        
        if (newManifest) {
            setPost(newManifest[1])
            updateUser({currentManifest: newManifest[0]})
        }
        
    }

    async function addLike() {
        const rs = await createRemoteStore(createContentClient("/storage", user.token))
        const {newManifest, like} = await likePost(post!, 
            (await crypto.subtle.generateKey("Ed25519", false, ["sign"])).privateKey, //todo
             user.ownGroupState, true, user.name, rs, 
             user.currentManifest,
             user.manifest.currentPostManifest,
             await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))


        setLikes(likes + 1)
        
        if (newManifest) {
            setPost(newManifest[1])
            updateUser({currentManifest: newManifest[0]})
        }
    }

    
    return (<>
        {post ? <><h2>{post.title}</h2>
        <div> {likes} likes</div>
        <div> {comments.length} comments</div>
        <div>Duration: {post.metrics.duration / 3600000} hours</div>
        <div>Elevation: {post.metrics.elevation} meters</div>
        <div>Distance: {post.metrics.distance / 1000} kilometers</div>
        </> : <></>}
        {gpxData ? <LeafletRouteMap route={gpxData} showMarkers/> : <></>}
        <button onClick={addLike}>Like</button>
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


function base64urlToUint8(s: string): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(s.replace(/\-/g, "+").replace(/\_/g, "/").replace(/=+$/, ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}