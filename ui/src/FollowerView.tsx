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
    

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-md p-8">
                    <h1 className="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                        <span>👥</span> {user.name}'s Followers
                    </h1>

                    {followers.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {followers.map(f => {
                                const id = new TextDecoder().decode(f)
                                return (
                                    <Link 
                                        key={id} 
                                        to={`/user/${id}/0`}
                                        className="block p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg hover:shadow-md transition-shadow"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center text-blue-600 font-bold">
                                                {id.charAt(0).toUpperCase()}
                                            </div>
                                            <span className="font-medium text-gray-900 hover:text-blue-600 transition-colors">{id}</span>
                                        </div>
                                    </Link>
                                )
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <p className="text-gray-500 text-lg">No followers yet</p>
                            <p className="text-gray-400 mt-2">Share your profile to gain followers!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default FollowerView