import { PostManifestPage, Manifest, StorageIdentifier, PostManifest, FollowerManifest, FollowerGroupState } from "./manifest"
import { StorageClient } from "./http/storageClient"
import { importAesKey, derivePostSecret } from "./createPost"
import { toBufferSource } from "ts-mls/util/byteArray.js"
import { decodePostManifestPage, decodeManifest, decodePostManifest, decodeFollowerManifest, decodeFollowerGroupState } from "./codec/decode"
import { CiphersuiteImpl, ClientState } from "ts-mls"

//TODO ideally there should be a single storage call that stores it locally and also stores it encrypted remote
//potentially the store could also store things remotely ever so often to save data
export interface RemoteStore {
  // storeGroupState(groupId: Uint8Array, state: ClientState): Promise<void>
  // storeCurrentManifest(userId: string, manifest: PostManifestPage, manifestId: string): Promise<void>
  // storePostComments(postId: Uint8Array, comment: Comment[]): Promise<void>
  // storePostLikes(postId: Uint8Array, like: Like[]): Promise<void>
  storeContent(id: Uint8Array, content: Uint8Array, nonce: Uint8Array): Promise<string>
  // storeFollowRequest(followeeId: string, publicPackage: KeyPackage, privatePackage: PrivateKeyPackage): Promise<void>

  // getGroupState(groupId: Uint8Array): Promise<ClientState>


  client: StorageClient
  getContent(storageId: string): Promise<{body: Uint8Array, nonce: string} | undefined>
  // getPost(
  //   storageId: StorageIdentifier,
  //   accessKey: Uint8Array
  // ): Promise<{ content: Uint8Array; nonce: Uint8Array; /*likes: Like[]; comments: Comment[]*/ }>
}


export function createRemoteStore(client: StorageClient): RemoteStore {

  return {
    async storeContent(id, content, nonce) {
      const storageId = uint8ToBase64Url(id)  //todo use hash?
      await client.putContent(storageId, content, nonce)
      return storageId
    },
    async getContent(storageId) {
      const res = await client.batchGetContent([base64urlToUint8(storageId)])
      return res[storageId]!
    },
    client
  }
}

export function uint8ToBase64Url(u8: Uint8Array): string {
  return btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export function base64urlToUint8(s: string): Uint8Array<ArrayBuffer> {
  const binary = globalThis.atob(s.replace(/\-/g, "+").replace(/\_/g, "/").replace(/=+$/, ""))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export async function retrieveAndDecryptContent(rs: RemoteStore, id: StorageIdentifier): Promise<ArrayBuffer> {
    const key = await importAesKey(id[1]);

    const resp = await rs.getContent(id[0]);

    const { body, nonce } = resp!;


    const n = base64urlToUint8(nonce);

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: n.buffer },
        key,
        toBufferSource(body)
    );
    return decrypted;
}

export async function retrieveAndDecryptPostManifestPage(rs: RemoteStore, id: StorageIdentifier): Promise<PostManifestPage | undefined> {
    try {
      const decrypted = await retrieveAndDecryptContent(rs, id);

      return decodePostManifestPage(new Uint8Array(decrypted));
    } catch (e) {
      //todo proper error handling
      return undefined
    }
}



export async function retrieveAndDecryptGroupState(rs: RemoteStore, storageId: string, masterKey: Uint8Array): Promise<FollowerGroupState | undefined> {
    try {
      const decrypted = await retrieveAndDecryptContent(rs, [storageId, masterKey]);

      return decodeFollowerGroupState(new Uint8Array(decrypted));
    } catch (e) {
      //todo proper error handling
      return undefined
    }
}

export async function retrieveAndDecryptManifest(rs: RemoteStore, manifestId: string, masterKey: Uint8Array): Promise<Manifest | undefined> {
    try {
      const decrypted = await retrieveAndDecryptContent(rs, [manifestId, masterKey]);

      return decodeManifest(new Uint8Array(decrypted));
    } catch (e) {
      //todo proper error handling
      return undefined
    }
}


export async function retrieveAndDecryptPostManifest(rs: RemoteStore, id: StorageIdentifier): Promise<PostManifest | undefined> {
    try {
      const decrypted = await retrieveAndDecryptContent(rs, id);

      return decodePostManifest(new Uint8Array(decrypted));
    } catch (e) {
      //todo proper error handling
      return undefined
    }
}


export async function retrieveAndDecryptFollowerPostManifest(rs: RemoteStore, mlsGroup: ClientState, impl: CiphersuiteImpl, followerManifestId: Uint8Array, masterKey: Uint8Array): Promise<[FollowerManifest, PostManifest, PostManifestPage]> {
  const decrypted = await retrieveAndDecryptContent(rs, [uint8ToBase64Url(followerManifestId), masterKey])

  const fm = decodeFollowerManifest(new Uint8Array(decrypted))

  const postSecret = await derivePostSecret(mlsGroup, impl)

  const [pm, page]= await Promise.all([
    retrieveAndDecryptPostManifest(rs, [fm.postManifest[0], postSecret]), 
    retrieveAndDecryptPostManifestPage(rs, [fm.currentPage[0], postSecret])
  ])

  return [fm, pm!, page!]
}


// there needs to be an index on the date of all followees post metas.
// then we can query that index to fetch the latest posts
