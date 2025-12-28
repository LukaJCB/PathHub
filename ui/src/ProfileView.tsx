import {PostManifestPage} from "pathhub-client/src/manifest.js"
import { Link, useParams } from "react-router";
import { useAuthRequired } from "./useAuth";
import { createRemoteStore } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { useEffect, useState } from "react";
import { getAllFollowees, getAllFollowers } from "pathhub-client/src/followRequest.js";
import { getPageForUser } from "pathhub-client/src/profile.js";
import { getCiphersuiteFromName, getCiphersuiteImpl} from "ts-mls";
import { PostPreview } from "./PostPreview";


export const ProfileView: React.FC = () => {

    const {user} = useAuthRequired()
    const params = useParams();
    const page = parseInt(params.page!)
    const profileUserId = params.userId!
    const [postManifestPage, setPostManifestPage] = useState<PostManifestPage | null>(null)
    const [canView, setCanView] = useState(true)
    const rs = createRemoteStore(createContentClient("/storage", user.token))
    useEffect(() => {
        const fetchData = async () => {
            const result = await getPageForUser(user.manifest, user.currentPage, user.postManifest, user.masterKey,
                user.id, profileUserId, page, rs, 
                await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"))
            )

            if (!result) {
                setCanView(false)
            } else {
                setPostManifestPage(result[0])
            }
        }

       fetchData()
    }, [params])

    
    //todo don't just blindly use user here
    return (<>
        <h1>{user.name}</h1>
        
        {canView ? (<>
        <div>
            <h2>Totals</h2>
            <div>Total Posts: {user.postManifest.totals.totalPosts}</div>
            <div>Total Duration: {user.postManifest.totals.totalDerivedMetrics.duration / 3600000} hours</div>
            <div>Total Elevation: {user.postManifest.totals.totalDerivedMetrics.elevation} meters</div>
            <div>Total Distance: {user.postManifest.totals.totalDerivedMetrics.distance / 1000} kilometers</div>
            <div><Link to="/followers">Followers: {getAllFollowers(user.ownGroupState).length}</Link></div>
            <div><Link to="/following">Following: {getAllFollowees(user.manifest).length}</Link></div>
        </div>
        {postManifestPage && (<>{postManifestPage.posts.map(post =>
            <PostPreview post={post} userId={profileUserId} page={page} token={user.token} key={post.main[0]}/>
        )}</>)}
        {page > 0 ? 
          <Link to={`/user/${profileUserId}/${page - 1}`} > {"<"} </Link> 
          : <></>
        }
        {page < user.currentPage.pageIndex ? 
          <Link to={`/user/${profileUserId}/${page + 1}`} > {">"} </Link> 
          : <></>
        }</>) : 
        (<div> 
            <h3>Follow this user to see their profile</h3>
            <button>Request to Follow</button>
        </div>)}
        
        </>
    )
}


export default ProfileView