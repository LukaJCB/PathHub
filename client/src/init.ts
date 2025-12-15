import {
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
import { CurrentPostManifest, Manifest2 } from "./manifest";
import { base64urlToUint8, RemoteStore, retrieveAndDecryptCurrentManifest, retrieveAndDecryptGroupState, retrieveAndDecryptManifest, uint8ToBase64Url } from "./remoteStore";
import { encryptAndStore, encryptAndStoreWithPostSecret } from "./createPost";
import { encodeCurrentPostManifest, encodeGroupState, encodeManifest } from "./codec/encode";


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


export async function initManifest(userId: string, manifestId: string, masterKey: Uint8Array, rs: RemoteStore): Promise<[Manifest2, CurrentPostManifest, ClientState]> {

  const y = await retrieveAndDecryptManifest(rs, manifestId, masterKey)
  if (y) {
    console.log("Found existing manifest")
    const pm = await retrieveAndDecryptCurrentManifest(rs, y.currentPostManifest)
    const gm = await retrieveAndDecryptGroupState(rs, uint8ToBase64Url(y.groupStateManifest), masterKey)
    return [y, pm!, gm!]
  } else {

    console.log("Creating new manifest")
    const pm: CurrentPostManifest = {
        manifestIndex: 0,
        posts: [], oldManifests: [], totals: {
            totalPosts: 0,
            totalDerivedMetrics: {
                distance: 0,
                elevation: 0,
                duration: 0
            }
        }
    }

    const groupState = await initGroupState(userId)


    const gmStorageId = crypto.getRandomValues(new Uint8Array(32))

    const impl = await getCiphersuiteImpl(
      getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"),
      defaultCryptoProvider,
    )


    const [pmStorage] = await Promise.all([
      encryptAndStore(groupState, impl, rs, encodeCurrentPostManifest(pm)), 
      encryptAndStoreWithPostSecret(masterKey, rs, encodeGroupState(groupState), gmStorageId)
    ])
  
    const manifest: Manifest2 = {
      currentPostManifest: pmStorage,
      groupStateManifest: gmStorageId,
      followeeManifests: new Map()
    }

    await encryptAndStoreWithPostSecret(masterKey, rs, encodeManifest(manifest), base64urlToUint8(manifestId))

    return [manifest, pm, groupState]
  }
  
}