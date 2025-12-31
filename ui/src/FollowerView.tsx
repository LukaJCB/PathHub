import { useAuthRequired } from "./useAuth";
import { createRemoteStore, RemoteStore } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { getAllFollowers, getAllFollowersForNonOwner } from "pathhub-client/src/followRequest.js";
import { createMessageClient, MessageClient } from "pathhub-client/src/http/messageClient.js";
import { Link, useParams } from "react-router";
import { useEffect, useState } from "react";
import { getGroupStateForUser, getPostManifestForUser } from "pathhub-client/src/profile.js";
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls";
import { getUserInfo } from "pathhub-client/src/userInfo.js";
import { createAuthenticationClient } from "pathhub-client/src/http/authenticationClient.js";
import { getAvatarImageUrl } from "./App";


export const FollowerView: React.FC = () => {

    const {user,updateUser} = useAuthRequired()
    const params = useParams();
    const profileUserId = params.userId!
    const messager: MessageClient = createMessageClient("/messaging", user.token)
    const remoteStore: RemoteStore = createRemoteStore(createContentClient("/storage", user.token))
    const [followers, setFollowers] = useState<string[]>([])
    const [avatar, setAvatar] = useState<string | null>(null)
    const [username, setUsername] = useState<string | null>(null)
    const [avatars, setAvatars] = useState<Map<string, string>>(new Map())
    const [usernames, setUsernames] = useState<Map<string, string>>(new Map())

    const [canView, setCanView] = useState(true)
    
    useEffect(() => {
            const fetchData = async () => {
                const result = await getGroupStateForUser(user.manifest, user.masterKey,
                    user.id, profileUserId, user.ownGroupState, remoteStore
                )
    
                if (!result) {
                    setCanView(false)
                } else {
                    const followerIds = getAllFollowersForNonOwner(result, profileUserId)

                    const avatars = new Map<string, string>()
                    const usernames = new Map<string, string>()
                    const followers: string[] = []
                    for (const f of followerIds) {
                        const userId = new TextDecoder().decode(f)
                        followers.push(userId)
                        const userInfo = await getUserInfo(userId, remoteStore.client, createAuthenticationClient("/auth"), user.token)
                        const avatar = getAvatarImageUrl(userInfo)
                        avatars.set(userId, avatar)
                        const username = userInfo.info.username
                        usernames.set(userId, username)
                    }

                    setFollowers(followers)
                    setAvatars(avatars)
                    setUsernames(usernames)

                    const userInfo = await getUserInfo(profileUserId, remoteStore.client, createAuthenticationClient("/auth"), user.token)
                    const avatar = profileUserId === user.id ? user.avatarUrl : getAvatarImageUrl(userInfo)
                    const username = profileUserId === user.id ? user.name : userInfo.info.username
                    if (avatar) { setAvatar(avatar) }
                    if (username) { setUsername(username)}
                }
            }
    
           fetchData()
        }, [params])

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
                <div className="bg-white rounded-lg shadow-md p-8">
                    <Link 
                        to={`/user/${profileUserId}/0`} 
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
                                {username ? username.slice(0, 2).toUpperCase() : profileUserId.slice(0, 2).toUpperCase()}
                            </div>
                        )}
                                
                    </Link>
                    <h1 className="text-3xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                        <span>👥</span> {username}'s Followers
                    </h1>

                    {followers.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {followers.map(id => {

                                return (
                                    <Link 
                                        key={id} 
                                        to={`/user/${id}/0`}
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