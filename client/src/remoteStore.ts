import { ClientState, KeyPackage, PrivateKeyPackage } from "ts-mls"
import { Comment, CurrentPostManifest, Like, StorageIdentifier } from "./manifest"
import { StorageClient } from "./http/storageClient"
import { deriveAccessAndEncryptionKeys } from "./createPost"
import { decode } from "cbor-x"
import { toBufferSource } from "ts-mls/util/byteArray.js"

//TODO ideally there should be a single storage call that stores it locally and also stores it encrypted remote
//potentially the store could also store things remotely ever so often to save data
export interface RemoteStore {
  // storeGroupState(groupId: Uint8Array, state: ClientState): Promise<void>
  // storeCurrentManifest(userId: string, manifest: CurrentPostManifest, manifestId: string): Promise<void>
  // storePostComments(postId: Uint8Array, comment: Comment[]): Promise<void>
  // storePostLikes(postId: Uint8Array, like: Like[]): Promise<void>
  storeContent(id: Uint8Array, content: Uint8Array, nonce: Uint8Array, accessKey: Uint8Array): Promise<string>
  // storeFollowRequest(followeeId: string, publicPackage: KeyPackage, privatePackage: PrivateKeyPackage): Promise<void>

  // getGroupState(groupId: Uint8Array): Promise<ClientState>


  getContent(storageId: string, accessKey: Uint8Array): Promise<{body: Uint8Array, nonce: string} | undefined>
  // getPost(
  //   storageId: StorageIdentifier,
  //   accessKey: Uint8Array
  // ): Promise<{ content: Uint8Array; nonce: Uint8Array; /*likes: Like[]; comments: Comment[]*/ }>
}


export async function createRemoteStore(client: StorageClient): Promise<RemoteStore> {

  return {
    async storeContent(id, content, nonce, accessKey) {
      const storageId = uint8ToBase64Url(id)  //todo use hash?
      await client.putContent(storageId, content, accessKey, nonce)
      return storageId
    },
    async getContent(storageId, accessKey) {
      const res = await client.batchGetContent([[base64urlToUint8(storageId), accessKey]])
      return res[storageId]!
    },
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
    const { key, accessKey } = await deriveAccessAndEncryptionKeys(id[1]);

    const resp = await rs.getContent(id[0], new Uint8Array(accessKey));

    const { body, nonce } = resp!;


    const n = base64urlToUint8(nonce);

    const decrypted = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: n.buffer },
        key,
        toBufferSource(body)
    );
    return decrypted;
}

export async function retrieveAndDecryptCurrentManifest(rs: RemoteStore, manifestId: string, masterKey: Uint8Array): Promise<CurrentPostManifest | undefined> {
    try {
      const decrypted = await retrieveAndDecryptContent(rs, [manifestId, masterKey]);

      return decode(new Uint8Array(decrypted));
    } catch (e) {
      //todo proper error handling
      return undefined
    }
}


// there needs to be an index on the date of all followees post metas.
// then we can query that index to fetch the latest posts

export async function storeContent(content: BufferSource) {
  // const dek = crypto.subtle.generateKey(
  //   {
  //     name: "AES-GCM",
  //     length: 256,
  //   },
  //   true,
  //   ["encrypt", "decrypt"],
  // )
  // // generate nonce
  // const nonce = crypto.getRandomValues(new Uint8Array(12))
  // // encrypt content
  // const encrypted = await crypto.subtle.encrypt(
  //     { name: "AES-GCM", iv: nonce },
  //     await dek,
  //     content,
  //   )
}
