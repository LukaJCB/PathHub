import { CiphersuiteImpl, ClientState, clientStateDecoder, mlsMessageDecoder, clientStateEncoder, processPrivateMessage, MlsMessage, wireformats, decode, unsafeTestingAuthenticationService, encode } from "ts-mls";
import { MessageClient } from "./http/messageClient";
import { FollowRequests, processAllowFollow, receiveFollowRequest } from "./followRequest";
import { FollowerManifest, Manifest, PostManifest, PostManifestPage, PostMeta, StorageIdentifier } from "./manifest";
import { base64urlToUint8, RemoteStore, retrieveAndDecryptGroupState, retrieveAndDecryptPostManifestPage, uint8ToBase64Url } from "./remoteStore";
import { decodeMessage, decodeMessagePublic } from "./codec/decode";
import { encryptAndStore, encryptAndStoreWithPostSecret, replaceInPage } from "./createPost";
import { encodeComments, encodeFollowerGroupState, encodeLikes } from "./codec/encode";
import { updateCommentList, updateLikeList } from "./postInteraction";


export async function processIncoming(client: MessageClient, manifest: Manifest, 
    postManifest: PostManifest,
    postManifestPage: PostManifestPage,
    manifestId: Uint8Array,
    ownGroupState: ClientState,
    followRequests: FollowRequests, 
    userId: string,
    masterKey: Uint8Array,
    remoteStore: RemoteStore,
impl: CiphersuiteImpl): Promise<[FollowRequests, Manifest, PostManifest, PostManifestPage, FollowerManifest | undefined, ClientState | undefined]> {
    const messages = await client.receiveMessages()

    console.log(`Fetched ${messages.length} message, processing...`)
    //need to apply this to more things that will get updated...
    let currentFollowRequests = followRequests
    let currentManifest = manifest
    let currentPage = postManifestPage
    let currentPostManifest = postManifest
    let currentFollowerManifest = undefined
    let currentClientState = undefined
    for (const m of messages) {
        const mp = decodeMessagePublic(m.payload)

        if (mp.kind === 'GroupMessage') {
          const message = decode(mlsMessageDecoder, mp.mlsMessage)!
          const result = await processMlsMessage(message, ownGroupState, m.sender, userId, postManifest, postManifestPage, currentManifest, manifestId, masterKey, currentFollowRequests, remoteStore, impl)

          currentFollowRequests = result[0]
          currentManifest = result[1]
          currentFollowerManifest = result[2] ?? currentFollowerManifest
          currentPage = result[4]
          currentPostManifest = result[5]
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

    console.log(`Finished processing ${messages.length} messages`)

   
    return [currentFollowRequests, currentManifest, currentPostManifest, currentPage, currentFollowerManifest, currentClientState]

}


export async function processMlsMessage(
    msg: MlsMessage,
    mlsGroup: ClientState,
    sender: string, 
    userId: string,
    postManifest: PostManifest,
    postManifestPage: PostManifestPage,
    manifest: Manifest,
    manifestId: Uint8Array,
    masterKey: Uint8Array,
    followRequests: FollowRequests,
    remoteStore: RemoteStore,
    impl: CiphersuiteImpl
): Promise<[FollowRequests, Manifest, FollowerManifest | undefined, ClientState | undefined, PostManifestPage, PostManifest]> {

    switch (msg.wireformat) {
        case wireformats.mls_welcome: {
            const result = await processAllowFollow(sender, msg.welcome, followRequests, masterKey, manifest, manifestId, remoteStore, impl)
            return [result[0],result[1],result[2],result[3], postManifestPage, postManifest]
        }
        case wireformats.mls_private_message: {
            const groupStateId = manifest.groupStates.get(uint8ToBase64Url(msg.privateMessage.groupId))!
            const followerGroupState = await retrieveAndDecryptGroupState(remoteStore, uint8ToBase64Url(groupStateId), masterKey)
            const groupState = decode(clientStateDecoder,followerGroupState!.groupState)!
            //todo only allow commits from group owner
            const result = await processPrivateMessage({ state: groupState, privateMessage: msg.privateMessage, context: { cipherSuite: impl, authService: unsafeTestingAuthenticationService } }) 

            console.log(result)
            if (result.kind === "applicationMessage") {
                const message = decodeMessage(result.message)
                console.log(message)
                if (message.kind === "Interaction") {

                    console.log(message)
                    console.log(userId)
                    if (userId === message.posterId) {
                        if (message.interaction.kind === "comment") {


                            const comment = message.interaction
                            const { meta,pageId} = (await findPostMeta(postManifestPage, postManifest, message.interaction.postId, remoteStore))!
                            const comments = await updateCommentList(meta, remoteStore, comment);
                                
                            const commentsEncoded = encodeComments(comments)
                        
                            const storageIdentifier = await encryptAndStore(mlsGroup,impl, remoteStore, commentsEncoded, meta?.comments ? base64urlToUint8(meta.comments[0]) : undefined)
                        
                            const newMeta: PostMeta = {
                                ...meta,
                                totalComments: meta.totalComments + 1,
                                sampleComments: [...meta.sampleComments.slice(1, meta.sampleComments.length), comment],
                                comments: storageIdentifier
                            }
                        
                            //todo send mls message to everyone who has previously commented on the post?
                            const [newPage, newPostManifest, newManifest] = await replaceInPage(mlsGroup, impl, postManifestPage, pageId, postManifest, manifest, manifestId, masterKey, newMeta, remoteStore)
                        
                            return [followRequests, newManifest, undefined, result.newState, newPage, newPostManifest]
                        } else {
                            const like = message.interaction
                            const { meta,pageId} = (await findPostMeta(postManifestPage, postManifest, message.interaction.postId, remoteStore))!
                            const likes = await updateLikeList(meta, remoteStore, like);
                                
                            const likesEncoded = encodeLikes(likes)
                        
                            const storageIdentifier = await encryptAndStore(mlsGroup,impl, remoteStore, likesEncoded, meta?.likes ? base64urlToUint8(meta.likes[0]) : undefined)
                        
                            const newMeta: PostMeta = {
                                ...meta,
                                totalLikes: meta.totalLikes + 1,
                                sampleLikes: [...meta.sampleLikes.slice(1, meta.sampleLikes.length), like],
                                comments: storageIdentifier
                            }
                        
                            //todo send mls message to everyone who has previously commented on the post?
                            const [, , newManifest] = await replaceInPage(mlsGroup, impl, postManifestPage, pageId, postManifest, manifest, manifestId, masterKey, newMeta, remoteStore)
                        
                            return [followRequests, newManifest, undefined, result.newState, postManifestPage, postManifest]
                        }
                    } else {
                    
                        const interactions = followerGroupState!.cachedInteractions.get(message.interaction.postId) ?? []

                        const newInteractions = [...interactions, message.interaction]

                        const newMap = followerGroupState?.cachedInteractions.set(message.interaction.postId, newInteractions)

                        const newFollowerGroupState = { groupState: encode(clientStateEncoder, result.newState), cachedInteractions: newMap!}

                        await encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowerGroupState(newFollowerGroupState), groupStateId)
                    }
                }
            } else if (result.kind === "newState") {
                const newFollowerGroupState = {...followerGroupState!, groupState: encode(clientStateEncoder, result.newState)}

                await encryptAndStoreWithPostSecret(masterKey, remoteStore, encodeFollowerGroupState(newFollowerGroupState), groupStateId)
                //todo flush cachedInteractions whenever a new commit arrives

            }

            return [followRequests, manifest, undefined, result.newState , postManifestPage, postManifest]

        }
        default: {
            //todo
            return [followRequests, manifest, undefined, undefined, postManifestPage, postManifest]
        }
    }
}

export async function findPostMeta(page: PostManifestPage, postManifest: PostManifest, postId: string, rs: RemoteStore): Promise<{meta: PostMeta, pageId: StorageIdentifier}  | undefined> {

    const inPage = page.posts.find(p => p.main[0] === postId)
    if (inPage) {
        return { meta: inPage, pageId: postManifest.currentPage }
    }

    for (const p of postManifest.pages) {
        const page = await retrieveAndDecryptPostManifestPage(rs, p.page)
        const found = page?.posts.find(p => p.main[0] === postId)
        if (found) return { meta: found, pageId: p.page }

    }
}