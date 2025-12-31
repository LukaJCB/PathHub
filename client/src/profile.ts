import { CiphersuiteImpl, ClientState, decodeGroupState } from "ts-mls";
import { Manifest, PostManifest, PostManifestPage, StorageIdentifier } from "./manifest";
import { RemoteStore, retrieveAndDecryptFollowerPostManifest, retrieveAndDecryptGroupState, retrieveAndDecryptPostManifestPage, uint8ToBase64Url } from "./remoteStore";
import { getGroupStateIdFromManifest } from "./init";
import { clientConfig } from "./mlsConfig";

export async function getPageForUser(manifest: Manifest, 
    currentPage: PostManifestPage, 
    postManifest: PostManifest,
    masterKey: Uint8Array,
    userId: string,
    profileUserId: string,
    pageNumber: number,
    ownGroupState: ClientState, rs: RemoteStore, impl: CiphersuiteImpl): Promise<[[PostManifestPage, StorageIdentifier], PostManifest, ClientState] | undefined> {
    if (userId !== profileUserId){
        const followerManifest = manifest.followerManifests.get(profileUserId)
        if (followerManifest) {
            const groupStateId = await getGroupStateIdFromManifest(manifest, profileUserId)
            const followerGroupState = await retrieveAndDecryptGroupState(rs, uint8ToBase64Url(groupStateId), masterKey)
            const groupState =  {...decodeGroupState(followerGroupState!.groupState, 0)![0], clientConfig }
            const [, pm, pmp] = await retrieveAndDecryptFollowerPostManifest(rs, groupState, impl, followerManifest, masterKey)
            return [await getPage(pmp, pm, pageNumber, rs), pm, groupState]
        } else {
            return undefined
        }
    } else {
        return [await getPage(currentPage, postManifest, pageNumber, rs), postManifest, ownGroupState]
    }
}

export async function getGroupStateForUser(manifest: Manifest, 
    masterKey: Uint8Array,
    userId: string,
    profileUserId: string,
    ownGroupState: ClientState, rs: RemoteStore): Promise<ClientState | undefined> {
    if (userId !== profileUserId){
        const followerManifest = manifest.followerManifests.get(profileUserId)
        if (followerManifest) {
            const groupStateId = await getGroupStateIdFromManifest(manifest, profileUserId)
            const followerGroupState = await retrieveAndDecryptGroupState(rs, uint8ToBase64Url(groupStateId), masterKey)
            return {...decodeGroupState(followerGroupState!.groupState, 0)![0], clientConfig }
        } else {
            return undefined
        }
    } else {
        return ownGroupState
    }
}


export async function getPostManifestForUser(manifest: Manifest,  
    postManifest: PostManifest,
    masterKey: Uint8Array,
    userId: string,
    profileUserId: string,
    rs: RemoteStore, impl: CiphersuiteImpl): Promise<PostManifest | undefined> {
    if (userId !== profileUserId){
        const followerManifest = manifest.followerManifests.get(profileUserId)
        if (followerManifest) {
            const groupStateId = await getGroupStateIdFromManifest(manifest, profileUserId)
            const followerGroupState = await retrieveAndDecryptGroupState(rs, uint8ToBase64Url(groupStateId), masterKey)
            const groupState =  {...decodeGroupState(followerGroupState!.groupState, 0)![0], clientConfig }

            const [, pm] = await retrieveAndDecryptFollowerPostManifest(rs, groupState!, impl, followerManifest, masterKey)
            return pm
        } else {
            return undefined
        }
    } else {
        return postManifest
    }
}


export async function getPage(currentPage: PostManifestPage, postManifest: PostManifest, pageNumber: number, rs: RemoteStore): Promise<[PostManifestPage, StorageIdentifier]> {
    const index = currentPage.pageIndex - pageNumber
    if (currentPage.pageIndex == index) {
        return [currentPage, postManifest.currentPage]
    } else {
        const pageId = postManifest.pages[index]!.page

        const page = await retrieveAndDecryptPostManifestPage(rs, pageId)
        return [page!, pageId]
    }
}