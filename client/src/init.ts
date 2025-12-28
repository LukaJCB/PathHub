import {
  CiphersuiteImpl,
  ClientState,
  createGroup,
  Credential,
  defaultCapabilities,
  defaultCryptoProvider,
  defaultLifetime,
  encodeRequiredCapabilities,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  RequiredCapabilities,
} from "ts-mls"
import { clientConfig } from "./mlsConfig"
import { deriveGroupIdFromUserId } from "./mlsInteractions";
import { PostManifestPage, Manifest, PostManifest } from "./manifest";
import { base64urlToUint8, RemoteStore, retrieveAndDecryptPostManifestPage, retrieveAndDecryptGroupState, retrieveAndDecryptManifest, uint8ToBase64Url, retrieveAndDecryptPostManifest } from "./remoteStore";
import { encryptAndStore, encryptAndStoreWithPostSecret } from "./createPost";
import { encodePostManifestPage, encodeFollowRequests, encodeClientState, encodeManifest, encodePostManifest } from "./codec/encode";
import { leafToNodeIndex, toLeafIndex } from "ts-mls/treemath.js";


export interface SignatureKeyPair {
  signKey: Uint8Array
  publicKey: Uint8Array
}

export async function initGroupState(userId: string): Promise<[ClientState, SignatureKeyPair]> {
  const credential: Credential = createCredential(userId)
  const impl = await getCiphersuiteImpl(
    getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"),
    defaultCryptoProvider,
  )

  const requiredCapabilities: RequiredCapabilities = {
    extensionTypes: [],
    proposalTypes: [],
    credentialTypes: ["basic"],
  }

  const kp = await generateKeyPackage(
    credential,
    defaultCapabilities(),
    defaultLifetime,
    [{ extensionType: "required_capabilities", extensionData: encodeRequiredCapabilities(requiredCapabilities) }],
    impl,
  )

  const groupId = await deriveGroupIdFromUserId(userId)

  const group = await createGroup(groupId, kp.publicPackage, kp.privatePackage, [], impl, clientConfig)

  const keyPair = {signKey: kp.privatePackage.signaturePrivateKey, publicKey: kp.publicPackage.leafNode.signaturePublicKey}
  return [group, keyPair]

}



export function createCredential(userId: string): Credential {
  return { credentialType: "basic", identity: new TextEncoder().encode(userId) };
}

export function getUserIdFromCredential(cred: Credential): string {
  if (cred.credentialType !== 'basic') throw new Error("Wrong cred type")
  
  return new TextDecoder().decode(cred.identity)
}

export function getKeyPairFromGroupState(state: ClientState): SignatureKeyPair {
  const idx = leafToNodeIndex(toLeafIndex(state.privatePath.leafIndex))
  const leaf = state.ratchetTree[idx]
  if (leaf?.nodeType !== "leaf") throw new Error("Expected leaf node")
  return {
    signKey: state.signaturePrivateKey,
    publicKey: leaf.leaf.signaturePublicKey
  }
}

export async function getOrCreateManifest(userId: string, manifestId: string, masterKey: Uint8Array, rs: RemoteStore): Promise<[Manifest, PostManifest, PostManifestPage, ClientState, SignatureKeyPair]> {

  const y = await retrieveAndDecryptManifest(rs, manifestId, masterKey)
  if (y) {

    const [[postManifest, page],gm] = await Promise.all([
      retrievePostManifestAndPage(rs, y),
      retrieveAndDecryptGroupState(rs, uint8ToBase64Url(await getGroupStateIdFromManifest(y, userId)), masterKey)
    ])

    return [y, postManifest!, page!, gm!, getKeyPairFromGroupState(gm!)]
  } else {

    const page: PostManifestPage = {
        pageIndex: 0,
        posts: []
    }

    const [groupState, keyPair] = await initGroupState(userId)


    const gmStorageId = crypto.getRandomValues(new Uint8Array(32))
    const frStorageId = crypto.getRandomValues(new Uint8Array(32))

    const impl = await getCiphersuiteImpl(
      getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"),
      defaultCryptoProvider,
    )


    const [[manifest, postManifest]] = await Promise.all([
      initManifest(groupState, impl, rs, page, gmStorageId, frStorageId, masterKey, manifestId),
      encryptAndStoreWithPostSecret(masterKey, rs, encodeClientState(groupState), gmStorageId),
      encryptAndStoreWithPostSecret(masterKey, rs, encodeFollowRequests({incoming:[], outgoing:[]}), frStorageId)
    ])
    

    return [manifest, postManifest, page, groupState, keyPair]
  }
  
}

export async function getGroupStateIdFromManifest(y: Manifest, userId: string): Promise<Uint8Array> {
  return y.groupStates.get(uint8ToBase64Url(await deriveGroupIdFromUserId(userId)))!
}

async function initManifest(groupState: ClientState, impl: CiphersuiteImpl, rs: RemoteStore, page: PostManifestPage, gmStorageId: Uint8Array, frStorageId: Uint8Array, masterKey: Uint8Array, manifestId: string): Promise<[Manifest, PostManifest]> {
    const [pm, pmStorage] = await initPostManifest(groupState, impl, rs, page);


    const manifest: Manifest = {
      postManifest: pmStorage,
      groupStates: new Map([[uint8ToBase64Url(groupState.groupContext.groupId), gmStorageId] as const]),
      followerManifests: new Map(),
      followRequests: frStorageId
    };

    await encryptAndStoreWithPostSecret(masterKey, rs, encodeManifest(manifest), base64urlToUint8(manifestId));

    return [manifest, pm]
}

async function initPostManifest(groupState: ClientState, impl: CiphersuiteImpl, rs: RemoteStore, page: PostManifestPage): Promise<[PostManifest, [string, Uint8Array]]> {
    const pageStorage = await encryptAndStore(groupState, impl, rs, encodePostManifestPage(page));

    const postManifest: PostManifest = {
      pages: [],
      currentPage: pageStorage,
      totals: {
        totalPosts: 0,
        totalDerivedMetrics: {
          distance: 0,
          elevation: 0,
          duration: 0
        }
      }
    };

    return [postManifest, await encryptAndStore(groupState, impl, rs, encodePostManifest(postManifest))] as const;

}

async function retrievePostManifestAndPage(rs: RemoteStore, y: Manifest): Promise<[PostManifest | undefined, PostManifestPage | undefined]> {
    const postManifest = await retrieveAndDecryptPostManifest(rs, y.postManifest);
    const page = await retrieveAndDecryptPostManifestPage(rs, postManifest!.currentPage);
    return [postManifest, page]
}
