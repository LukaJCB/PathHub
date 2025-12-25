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
import { encodePostManifestPage, encodeFollowRequests, encodeGroupState, encodeManifest, encodePostManifest } from "./codec/encode";


export async function initGroupState(userId: string) {
  const credential: Credential = { credentialType: "basic", identity: new TextEncoder().encode(userId) }
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

  return await createGroup(groupId, kp.publicPackage, kp.privatePackage, [], impl, clientConfig)

}


export async function getOrCreateManifest(userId: string, manifestId: string, masterKey: Uint8Array, rs: RemoteStore): Promise<[Manifest, PostManifest, PostManifestPage, ClientState]> {

  const y = await retrieveAndDecryptManifest(rs, manifestId, masterKey)
  if (y) {
    console.log("Found existing manifest")
    const [[postManifest, page]] = await Promise.all([
      retrievePostManifestAndPage(rs, y),
      retrieveAndDecryptGroupState(rs, uint8ToBase64Url(y.groupStateManifest), masterKey)
    ])
    const gm = await retrieveAndDecryptGroupState(rs, uint8ToBase64Url(y.groupStateManifest), masterKey)
    return [y, postManifest!, page!, gm!]
  } else {

    
    console.log("Creating new manifest")
    const page: PostManifestPage = {
        pageIndex: 0,
        posts: []
    }

    const groupState = await initGroupState(userId)


    const gmStorageId = crypto.getRandomValues(new Uint8Array(32))
    const frStorageId = crypto.getRandomValues(new Uint8Array(32))

    const impl = await getCiphersuiteImpl(
      getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"),
      defaultCryptoProvider,
    )


    const [[manifest, postManifest]] = await Promise.all([
      initManifest(groupState, impl, rs, page, gmStorageId, frStorageId, masterKey, manifestId),
      encryptAndStoreWithPostSecret(masterKey, rs, encodeGroupState(groupState), gmStorageId),
      encryptAndStoreWithPostSecret(masterKey, rs, encodeFollowRequests([]), frStorageId)
    ])
    

    return [manifest, postManifest, page, groupState]
  }
  
}

async function initManifest(groupState: ClientState, impl: CiphersuiteImpl, rs: RemoteStore, page: PostManifestPage, gmStorageId: Uint8Array, frStorageId: Uint8Array, masterKey: Uint8Array, manifestId: string): Promise<[Manifest, PostManifest]> {
    const [pm, pmStorage] = await initPostManifest(groupState, impl, rs, page);

    const manifest: Manifest = {
      postManifest: pmStorage,
      groupStateManifest: gmStorageId,
      followeeManifests: new Map(),
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
