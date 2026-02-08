import {
  PostManifestPage,
  Manifest,
  StorageIdentifier,
  PostManifest,
  FollowerManifest,
  FollowerGroupState,
  Entity,
  NotArray,
} from "./manifest"
import { StorageClient } from "./http/storageClient"
import { importAesKey, derivePostSecret } from "./createPost"
import { toBufferSource } from "ts-mls"
import {
  decodePostManifestPage,
  decodeManifest,
  decodePostManifest,
  decodeFollowerManifest,
  decodeFollowerGroupState,
} from "./codec/decode"
import { CiphersuiteImpl, ClientState } from "ts-mls"

//TODO ideally there should be a single storage call that stores it locally and also stores it encrypted remote
//potentially the store could also store things remotely ever so often to save data
export interface RemoteStore {
  // storeGroupState(groupId: Uint8Array, state: ClientState): Promise<void>
  // storeCurrentManifest(userId: string, manifest: PostManifestPage, manifestId: string): Promise<void>
  // storePostComments(postId: Uint8Array, comment: Comment[]): Promise<void>
  // storePostLikes(postId: Uint8Array, like: Like[]): Promise<void>
  storeContent(id: Uint8Array, content: Uint8Array, nonce: Uint8Array, version?: bigint): Promise<string>

  batchStoreContent(
    payloads: Array<{ id: Uint8Array; content: Uint8Array; nonce: Uint8Array; version?: bigint }>,
    extra: Uint8Array,
  ): Promise<void>
  // storeFollowRequest(followeeId: string, publicPackage: KeyPackage, privatePackage: PrivateKeyPackage): Promise<void>

  // getGroupState(groupId: Uint8Array): Promise<ClientState>

  client: StorageClient
  getContent(storageId: string): Promise<{ body: Uint8Array; nonce: string; version: bigint } | undefined>
  // getPost(
  //   storageId: StorageIdentifier,
  //   accessKey: Uint8Array
  // ): Promise<{ content: Uint8Array; nonce: Uint8Array; /*likes: Like[]; comments: Comment[]*/ }>
}

export function createRemoteStore(client: StorageClient): RemoteStore {
  return {
    async storeContent(id, content, nonce, version) {
      const storageId = uint8ToBase64Url(id)
      await client.putContent(storageId, content, nonce, version)
      return storageId
    },
    async batchStoreContent(payloads, extra) {
      await client.batchPut(
        payloads.map((p) => ({
          id: uint8ToBase64Url(p.id),
          body: p.content,
          nonce: p.nonce,
          version: p.version,
        })),
        extra,
      )
    },
    async getContent(storageId) {
      const res = await client.batchGetContent([base64urlToUint8(storageId)])
      return res[storageId]!
    },
    client,
  }
}

export function uint8ToBase64Url(u8: Uint8Array): string {
  return btoa(String.fromCharCode(...u8))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

export function base64urlToUint8(s: string): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function retrieveAndDecryptContent(
  rs: RemoteStore,
  id: StorageIdentifier,
): Promise<[ArrayBuffer, bigint]> {
  const key = await importAesKey(id[1])

  const resp = await rs.getContent(id[0])

  const { body, nonce, version } = resp!

  const n = base64urlToUint8(nonce)

  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: n.buffer }, key, toBufferSource(body))
  return [decrypted, BigInt(version)]
}

export async function retreiveDecryptAndDecode<T>(
  rs: RemoteStore,
  id: StorageIdentifier,
  dec: (b: Uint8Array) => NotArray<T>,
): Promise<Entity<T> | undefined> {
  try {
    const [buf, version] = await retrieveAndDecryptContent(rs, id)
    const result = dec(new Uint8Array(buf))

    return { ...result, version, storage: id }
  } catch (e) {
    //todo proper error handling
    return undefined
  }
}

export async function retrieveAndDecryptPostManifestPage(
  rs: RemoteStore,
  id: StorageIdentifier,
): Promise<Entity<PostManifestPage> | undefined> {
  return retreiveDecryptAndDecode<PostManifestPage>(rs, id, decodePostManifestPage)
}

export async function retrieveAndDecryptGroupState(
  rs: RemoteStore,
  storageId: string,
  masterKey: Uint8Array,
): Promise<Entity<FollowerGroupState> | undefined> {
  return retreiveDecryptAndDecode<FollowerGroupState>(rs, [storageId, masterKey], decodeFollowerGroupState)
}

export async function retrieveAndDecryptManifest(
  rs: RemoteStore,
  manifestId: string,
  masterKey: Uint8Array,
): Promise<Entity<Manifest> | undefined> {
  return retreiveDecryptAndDecode<Manifest>(rs, [manifestId, masterKey], decodeManifest)
}

export async function retrieveAndDecryptPostManifest(
  rs: RemoteStore,
  id: StorageIdentifier,
): Promise<Entity<PostManifest> | undefined> {
  return retreiveDecryptAndDecode<PostManifest>(rs, id, decodePostManifest)
}

export async function retrieveAndDecryptFollowerPostManifest(
  rs: RemoteStore,
  mlsGroup: ClientState,
  impl: CiphersuiteImpl,
  followerManifestId: Uint8Array,
  masterKey: Uint8Array,
): Promise<[Entity<FollowerManifest>, Entity<PostManifest>, Entity<PostManifestPage>]> {
  const fm = await retreiveDecryptAndDecode(
    rs,
    [uint8ToBase64Url(followerManifestId), masterKey],
    decodeFollowerManifest,
  )

  const postSecret = await derivePostSecret(mlsGroup, impl)

  const [pm, page] = await Promise.all([
    retrieveAndDecryptPostManifest(rs, [fm!.postManifest[0], postSecret]),
    retrieveAndDecryptPostManifestPage(rs, [fm!.currentPage[0], postSecret]),
  ])

  return [fm!, pm!, page!]
}

// there needs to be an index on the date of all followees post metas.
// then we can query that index to fetch the latest posts
