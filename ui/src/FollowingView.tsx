import { Link } from "react-router";
import { useAuthRequired } from "./useAuth";
import { getAllFollowees } from "pathhub-client/src/followRequest.js";
import { useEffect, useState } from "react";
import { createRemoteStore } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { getUserInfo } from "pathhub-client/src/userInfo.js";
import { createAuthenticationClient } from "pathhub-client/src/http/authenticationClient.js";
import { getAvatarImageUrl } from "./App";


export const FollowingView: React.FC = () => {

    const {user} = useAuthRequired()
    const following = getAllFollowees(user.manifest)
    const remoteStore = createRemoteStore(createContentClient("/storage", user.token))
    const [avatar, setAvatar] = useState<string | null>(null)
    const [username, setUsername] = useState<string | null>(null)
    const [avatars, setAvatars] = useState<Map<string, string>>(new Map())
    const [usernames, setUsernames] = useState<Map<string, string>>(new Map())

    useEffect(() => {
        const fetchData = async () => {
            const avatars = new Map<string, string>()
            const usernames = new Map<string, string>()
            for (const id of following) {
                const userInfo = await getUserInfo(id, remoteStore.client, createAuthenticationClient("/auth"), user.token)
                const avatar = getAvatarImageUrl(userInfo)
                if (avatar) avatars.set(id, avatar)
                const username = userInfo.info!.username
                if (username) usernames.set(id, username)
            }
            setAvatars(avatars)
            setUsernames(usernames)

            const userInfo = await getUserInfo(user.id, remoteStore.client, createAuthenticationClient("/auth"), user.token)
            const userAvatar = user.avatarUrl ? user.avatarUrl : getAvatarImageUrl(userInfo)
            const userName = user.name
            if (userAvatar) { setAvatar(userAvatar) }
            if (userName) { setUsername(userName) }
        }
        fetchData()
    }, [user])
    

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <div className="bg-white rounded-lg shadow-md p-8">
                    <Link 
                        to={`/user/${user.id}`} 
                        aria-label="Open profile"
                        className="flex items-center gap-3 mb-4 hover:opacity-80"
                    >
                        {avatar ? (
                            <img 
                                src={avatar} 
                                alt="Avatar" 
                                className="w-12 h-12 rounded-full object-cover ring-2 ring-indigo-100"
                            />
                        ) : (
                            <div className="w-12 h-12 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-sm font-semibold">
                                {username ? username.slice(0, 2).toUpperCase() : user.id.slice(0, 2).toUpperCase()}
                            </div>
                        )}
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                        <span>🔗</span> {username || user.name} Follows
                    </h1>

                    {following.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {following.map(id => (
                                <Link 
                                    key={id} 
                                    to={`/user/${id}`}
                                    className="block p-4 bg-gray-50 border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
                                >
                                    <div className="flex items-center gap-3">
                                        {avatars.get(id) ? (
                                            <img src={avatars.get(id)} alt="Avatar" className="w-8 h-8 rounded-full object-cover ring-2 ring-indigo-100" />
                                        ) : (
                                            <div className="w-8 h-8 rounded-full bg-indigo-200 text-indigo-700 flex items-center justify-center text-xs font-semibold">
                                                {id?.slice(0,2).toUpperCase()}
                                            </div>
                                        )}
                                        <span className="font-medium text-gray-900 hover:text-blue-600 transition-colors">{usernames.get(id) ?? id}</span>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-12">
                            <p className="text-gray-500 text-lg">Not following anyone yet</p>
                            <p className="text-gray-400 mt-2">Follow other users to see their activities!</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default FollowingView