import { useAuthRequired } from "./useAuth";
import { base64urlToUint8, createRemoteStore, RemoteStore, retrieveAndDecryptContent, uint8ToBase64Url } from "pathhub-client/src/remoteStore.js";
import { createContentClient } from "pathhub-client/src/http/storageClient.js";
import { FormEvent, useEffect, useState } from "react";
import { allowFollow, FollowRequests, requestFollow } from "pathhub-client/src/followRequest.js";
import { decodeFollowRequests } from "pathhub-client/src/codec/decode.js";
import { createCredential, getKeyPairFromGroupState } from "pathhub-client/src/init.js";
import { createMessageClient, MessageClient } from "pathhub-client/src/http/messageClient.js";
import { getIncoming } from "pathhub-client/src/inbox.js";
import { getCiphersuiteFromName, getCiphersuiteImpl } from "ts-mls";
import { decodeKeyPackage } from "ts-mls/keyPackage.js";


export const FollowRequestsView: React.FC = () => {

    const {user,updateUser} = useAuthRequired()
    const [followRequests, setFollowRequests] = useState<FollowRequests | null>(null)
    const [userId, setUserId] = useState("");
    const messager: MessageClient = createMessageClient("/messaging", user.token)
    const remoteStore: RemoteStore = createRemoteStore(createContentClient("/storage", user.token))
    useEffect(() => {
        const fetchData = async () => {
            const result = await retrieveAndDecryptContent(remoteStore, [uint8ToBase64Url(user.manifest.followRequests), user.masterKey])
            const fr = decodeFollowRequests(new Uint8Array(result))
            setFollowRequests(fr)

            const res = await getIncoming(messager, user.manifest, base64urlToUint8(user.manifestId), fr, user.id, user.masterKey, remoteStore, await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))
            setFollowRequests(res[0])
            updateUser({manifest: res[1]})
        }

       fetchData()
    }, [])

    
    
    async function acceptFollower(fr: FollowRequests, i: { followerId: string; keyPackage: Uint8Array; }): Promise<void> {

        const kp = decodeKeyPackage(i.keyPackage, 0)![0]

        const [newFollowRequests, newGroup, newManifest, newPostManifest] = await allowFollow(i.followerId, user.id, kp, fr, user.currentPage, user.postManifest, 
            user.manifest, base64urlToUint8(user.manifestId), user.masterKey, remoteStore, messager, user.ownGroupState,
            await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"))
        )
        updateUser({manifest: newManifest, postManifest: newPostManifest, ownGroupState: newGroup})
        setFollowRequests(newFollowRequests)

    }

    async function handleSubmitFollowRequest(e: FormEvent, followRequests: FollowRequests) {
        e.preventDefault()

        const newFollowRequests = await requestFollow(createCredential(user.id), userId, getKeyPairFromGroupState(user.ownGroupState), followRequests, 
            user.manifest.followRequests, user.masterKey, messager, remoteStore, 
            await getCiphersuiteImpl(getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")))

        setFollowRequests(newFollowRequests)
        setUserId("")
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-3xl font-bold text-gray-900 mb-8">Follow Requests</h1>
                
                {followRequests && (
                    <div className="space-y-8">
                        {/* Inbound Requests */}
                        <div className="bg-white rounded-lg shadow-md p-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <span>📥</span> Inbound Requests ({followRequests.incoming.length})
                            </h2>
                            {followRequests.incoming.length > 0 ? (
                                <div className="space-y-3">
                                    {followRequests.incoming.map(i => (
                                        <div key={i.followerId} className="flex items-center justify-between bg-gray-50 p-4 rounded-lg border border-gray-200">
                                            <span className="font-medium text-gray-900">{i.followerId}</span>
                                            <button 
                                                onClick={e => acceptFollower(followRequests, i)}
                                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors"
                                            >
                                                Accept
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500">No inbound requests</p>
                            )}
                        </div>

                        {/* Outbound Requests */}
                        <div className="bg-white rounded-lg shadow-md p-8">
                            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                                <span>📤</span> Outbound Requests ({followRequests.outgoing.length})
                            </h2>
                            {followRequests.outgoing.length > 0 ? (
                                <div className="space-y-3">
                                    {followRequests.outgoing.map(i => (
                                        <div key={i.followeeId} className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                            <span className="font-medium text-gray-900">{i.followeeId}</span>
                                            <p className="text-sm text-gray-500 mt-1">Pending approval</p>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-gray-500">No outbound requests</p>
                            )}
                        </div>

                        {/* New Request Form */}
                        <div className="bg-white rounded-lg shadow-md p-8">
                            <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                                <span>➕</span> Send Follow Request
                            </h3>
                            <form onSubmit={e => handleSubmitFollowRequest(e, followRequests)} className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        User ID
                                    </label>
                                    <input
                                        type="text" 
                                        value={userId}
                                        onChange={(e) => setUserId(e.target.value)}
                                        placeholder="Enter user ID"
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
                                    />
                                </div>
                                <button 
                                    type="submit" 
                                    className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
                                >
                                    Send Request
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default FollowRequestsView