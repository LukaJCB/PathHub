import { CiphersuiteImpl, ClientState, decodeMlsMessage, emptyPskIndex, processPrivateMessage } from "ts-mls";
import { MessageClient } from "./http/messageClient";
import { MLSMessage } from "ts-mls/message.js";
import { FollowRequests, processAllowFollow, receiveFollowRequest } from "./followRequest";
import { FollowerManifest, Manifest } from "./manifest";
import { RemoteStore, retrieveAndDecryptGroupState, uint8ToBase64Url } from "./remoteStore";
import { getGroupStateIdFromManifest } from "./init";
import { decodeMessagePublic } from "./codec/decode";


export async function getIncoming(client: MessageClient, manifest: Manifest,
    manifestId: Uint8Array,
    followRequests: FollowRequests, 
    userId: string,
    masterKey: Uint8Array,
    remoteStore: RemoteStore,
impl: CiphersuiteImpl): Promise<[FollowRequests, Manifest, FollowerManifest | undefined, ClientState | undefined]> {
    const messages = await client.receiveMessages()

    let currentFollowRequests = followRequests
    let currentManifest = manifest
    let currentFollowerManifest = undefined
    let currentClientState = undefined
    for (const m of messages) {
        const mp = decodeMessagePublic(m.payload)
        if (mp.kind === 'GroupMessage') {
          const message = decodeMlsMessage(mp.mlsMessage, 0)![0]
          const result = await processMlsMessage(message, m.sender, userId, currentManifest, manifestId, masterKey, currentFollowRequests, remoteStore, impl)

          currentFollowRequests = result[0]
          currentManifest = result[1]
          currentFollowerManifest = result[2] ?? currentFollowerManifest
          currentClientState = result[3] ?? currentClientState
        } else {
          
          const newFollowRequests = 
            await receiveFollowRequest(mp.keyPackage, m.sender, currentFollowRequests, manifest.followRequests, masterKey, remoteStore)

          currentFollowRequests = newFollowRequests
        }
    }
    
    if (messages.length > 0) {
        await client.ackMessages({messageIds: messages.map(m => m.id)})
    }

   
    return [currentFollowRequests, currentManifest, currentFollowerManifest, currentClientState]

}


export async function processMlsMessage(
    msg: MLSMessage, 
    sender: string, 
    userId: string,
    manifest: Manifest,
    manifestId: Uint8Array,
    masterKey: Uint8Array,
    followRequests: FollowRequests,
    remoteStore: RemoteStore,
    impl: CiphersuiteImpl
): Promise<[FollowRequests, Manifest, FollowerManifest | undefined, ClientState | undefined]> {
    switch (msg.wireformat) {
        case "mls_welcome": {
            const result = await processAllowFollow(sender, msg.welcome, followRequests, masterKey, manifest, manifestId, remoteStore, impl)
            return result
        }
        case "mls_private_message": {
            const groupStateId = manifest.groupStates.get(uint8ToBase64Url(msg.privateMessage.groupId))!
            const groupState = await retrieveAndDecryptGroupState(remoteStore, uint8ToBase64Url(groupStateId), masterKey)
            //todo only allow commits from group owner
            const result = await processPrivateMessage(groupState!, msg.privateMessage, emptyPskIndex, impl) 

            if (result.kind === "applicationMessage") {
                
                result.message
            }

            return [followRequests, manifest, undefined, result.newState]

        }
        default: {
            //todo
            return [followRequests, manifest, undefined, undefined]
        }
    }
}


