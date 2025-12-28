import { useAuthRequired } from "./useAuth";
import { createRemoteStore, RemoteStore } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { getAllFollowers } from "pathhub-client/src/followRequest.js";
import { createMessageClient, MessageClient } from "pathhub-client/src/http/messageClient.js";
import { Link } from "react-router";


export const FollowerView: React.FC = () => {

    const {user,updateUser} = useAuthRequired()
    const messager: MessageClient = createMessageClient("/messaging", user.token)
    const remoteStore: RemoteStore = createRemoteStore(createContentClient("/storage", user.token))
    const followers = getAllFollowers(user.ownGroupState)
    

    return (<>
        <h1>{user.name}'s Followers</h1>
        <div>
            <ul>
                {followers.map(f => {
                    const id = new TextDecoder().decode(f)
                    return (<li key={id}>
                    <Link to={`/user/${id}/0`}>{id}</Link>
                    </li>)
                })}
            </ul>
        </div></>)
}

    


export default FollowerView