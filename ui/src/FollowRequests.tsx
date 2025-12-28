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
    }

    return (<>
        <h1>Follow Requests</h1>
        
        {followRequests && (<>
        <div>
            <h2>Inbound</h2>
            {followRequests.incoming.map(i => 
                <><div>{i.followerId}</div>
                <button onClick={e => acceptFollower(followRequests, i)}>Accept</button>
                </>
            )}
            <h2>Outbound</h2>
            {followRequests.outgoing.map(i => 
                <div>{i.followeeId}</div>
            )}
        </div>
        <div>
            <h3>Create new Follow Request</h3>
            <form onSubmit={e => handleSubmitFollowRequest(e, followRequests)}>
                <label>User:</label>
                <input
                type="text" 
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                />
                <input type="submit" value={"Request"} />
            </form>
        </div></>)
}
        </>
    )
}

export default FollowRequestsView