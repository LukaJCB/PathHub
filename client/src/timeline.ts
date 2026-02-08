import { CiphersuiteImpl } from "ts-mls"
import { Manifest, PostManifestPage, PostMeta } from "./manifest"
import {
  RemoteStore,
  retrieveAndDecryptFollowerPostManifest,
  retrieveAndDecryptGroupState,
  uint8ToBase64Url,
} from "./remoteStore"
import { getGroupStateIdFromManifest } from "./init"

export interface TimelineItem {
  post: PostMeta
  userId: string
  page: number
}

export async function getTimeline(
  manifest: Manifest,
  userId: string,
  currentPage: PostManifestPage,
  masterKey: Uint8Array,
  rs: RemoteStore,
  impl: CiphersuiteImpl,
): Promise<TimelineItem[]> {
  const pages = currentPage.posts.map((post) => ({ post, userId, page: currentPage.pageIndex }))

  //todo parallelize this
  for (const [userId, followerManifest] of manifest.followerManifests.entries()) {
    const groupStateId = await getGroupStateIdFromManifest(manifest, userId)
    const followerGroupState = await retrieveAndDecryptGroupState(rs, uint8ToBase64Url(groupStateId), masterKey)
    const groupState = followerGroupState!.groupState
    const [, , pmp] = await retrieveAndDecryptFollowerPostManifest(rs, groupState, impl, followerManifest, masterKey)

    pages.push(...pmp.posts.map((post) => ({ post, userId, page: pmp.pageIndex })))
  }

  return pages.sort((a, b) => b.post.date - a.post.date)
}
