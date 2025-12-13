import {CurrentPostManifest, PostMeta} from "pathhub-client/src/manifest.js"
import { Link } from "react-router";


type Props = {
  username: string,
  userId: string,
  manifest: CurrentPostManifest;
};

export const ProfileView: React.FC<Props> = ({ username, userId, manifest }) => {
    
    return (<>
        <h1>{username}</h1>
        
        <div>
            <h2>Totals</h2>
            <div>Total Posts: {manifest.totals.totalPosts}</div>
            <div>Total Duration: {manifest.totals.totalDerivedMetrics.duration / 3600000} hours</div>
            <div>Total Elevation: {manifest.totals.totalDerivedMetrics.elevation} meters</div>
            <div>Total Distance: {manifest.totals.totalDerivedMetrics.distance / 1000} kilometers</div>
        </div>
        {manifest.posts.map(post =>
            <PostPreview post={post} user={userId} key={post.main[0]}/>
        )}
        </>
    )
}

type Props2 = {
    post: PostMeta
    user: string
}

const PostPreview: React.FC<Props2> = ({post, user}) => {
    
    return (<>
        <Link to={`/user/${user}/1/${post.main[0]}`}><h2>{post.title}</h2></Link>
        <div> {post.totalLikes} likes</div>
        <div> {post.totalComments} comments</div>
        <div>Duration: {post.metrics.duration / 3600000} hours</div>
        <div>Elevation: {post.metrics.elevation} meters</div>
        <div>Distance: {post.metrics.distance / 1000} kilometers</div>
    </>)
}

export default ProfileView