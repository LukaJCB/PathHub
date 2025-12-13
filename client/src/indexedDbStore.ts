import { openDB, DBSchema } from "idb"
import { bytesToBase64, ClientState, KeyPackage, PrivateKeyPackage } from "ts-mls"
import { CurrentPostManifest } from "./manifest"
import { LocalStore } from "./localStore"
import { defaultClientConfig } from "ts-mls/clientConfig.js"

interface Schema extends DBSchema {
  followRequests: {
    key: string
    value: {
      publicPackage: KeyPackage
      privatePackage: PrivateKeyPackage
    }
  }
  manifests: {
    key: string
    value: {
      manifest: CurrentPostManifest
      user: string
    }
    indexes: { user: string }
  }
  groupStates: {
    key: string
    value: ClientState
  },
  content: {
    key: string,
    value: {
      content: Uint8Array,
      nonce: Uint8Array
    }
  }
}

export async function makeStore(userid: string): Promise<LocalStore> {
  console.log(userid)
  const db = await openDB<Schema>(`ph-${userid}`, 1, {
    upgrade(db) {
      db.createObjectStore("followRequests")
      db.createObjectStore("groupStates")
      db.createObjectStore("content")
      const manifests = db.createObjectStore("manifests")
      manifests.createIndex("user", "user")
    },
  })

  return {
    async storeFollowRequest(followeeId: string, publicPackage: KeyPackage, privatePackage: PrivateKeyPackage) {
      await db.put("followRequests", { publicPackage, privatePackage }, followeeId)
    },
    async removeFollowRequest(followeeId: string) {
      await db.delete("followRequests", followeeId)
    },
    async storeCurrentManifest(userId, manifest, manifestId) {
      await db.put("manifests", { manifest, user: userId }, manifestId)
    },
    async storeGroupState(state) {
      const config = state.clientConfig;
      (state as any).clientConfig = {}
      await db.put("groupStates", state, bytesToBase64(state.groupContext.groupId))
      state.clientConfig = config //todo very hacky
    },
    async getGroupState(groupId) {
      const state =  await db.get("groupStates", groupId)
      if (state) { state.clientConfig = defaultClientConfig } //todo obvs
      return state
    },
    async getContent(storageId) {
      return await db.get("content", storageId)
    },
    async getCurrentManifest(userId) {
      const a = await db.getFromIndex("manifests", "user", userId)
      return a?.manifest
    },
    async storeContent(content, nonce) {
      const storageId = uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32)))  //todo use hash?
      await db.put("content", { content, nonce}, storageId)
      return storageId
    },
  }
}


function uint8ToBase64Url(u8: Uint8Array) {
  return btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}