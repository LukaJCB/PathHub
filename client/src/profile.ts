import { CiphersuiteImpl } from "ts-mls";
import { Manifest, PostManifest, PostManifestPage, StorageIdentifier } from "./manifest";
import { RemoteStore, retrieveAndDecryptFollowerPostManifest, retrieveAndDecryptGroupState, retrieveAndDecryptPostManifestPage, uint8ToBase64Url } from "./remoteStore";
import { getGroupStateIdFromManifest } from "./init";


export async function getPageForUser(manifest: Manifest, 
    currentPage: PostManifestPage, 
    postManifest: PostManifest,
    masterKey: Uint8Array,
    userId: string,
    profileUserId: string,
    pageNumber: number, rs: RemoteStore, impl: CiphersuiteImpl): Promise<[PostManifestPage, StorageIdentifier] | undefined> {
    if (userId !== profileUserId){
        const followerManifest = manifest.followerManifests.get(profileUserId)
        if (followerManifest) {
            const groupStateId = await getGroupStateIdFromManifest(manifest, profileUserId)
            const groupState = await retrieveAndDecryptGroupState(rs, uint8ToBase64Url(groupStateId), masterKey)
            const [, pm, pmp] = await retrieveAndDecryptFollowerPostManifest(rs, groupState!, impl, followerManifest, masterKey)
            return getPage(pmp, pm, pageNumber, rs)
        } else {
            return undefined
        }
    } else {
        return getPage(currentPage, postManifest, pageNumber, rs)
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