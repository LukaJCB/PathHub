import { Link } from "react-router";
import { useAuthRequired } from "./useAuth";
import { getAllFollowees } from "pathhub-client/src/followRequest.js";


export const FollowingView: React.FC = () => {

    const {user} = useAuthRequired()
    const following = getAllFollowees(user.manifest)
    

    return (<>
        <h1>{user.name} Follows</h1>
        <div>
            <ul>
                {following.map(id => (
                    <li key={id}>
                    <Link to={`/user/${id}/0`}>{id}</Link>
                    </li>))}
            </ul>
        </div></>)
}

    


export default FollowingView