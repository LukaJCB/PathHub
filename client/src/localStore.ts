import { ClientState, KeyPackage, PrivateKeyPackage } from "ts-mls"
import { PostManifestPage } from "./manifest"

export interface LocalStore {
  storeGroupState(state: ClientState): Promise<void>
  storeCurrentManifest(userId: string, manifest: PostManifestPage, manifestId: string): Promise<void>
  storeFollowRequest(followeeId: string, publicPackage: KeyPackage, privatePackage: PrivateKeyPackage): Promise<void>
  storeContent(content: Uint8Array, nonce: Uint8Array): Promise<string>
  removeFollowRequest(followeeId: string): Promise<void>

  getGroupState(groupId: string): Promise<ClientState | undefined>
  getCurrentManifest(userId: string): Promise<PostManifestPage | undefined>
  getContent(storageId: string): Promise<{content: Uint8Array, nonce: Uint8Array} | undefined>
}
