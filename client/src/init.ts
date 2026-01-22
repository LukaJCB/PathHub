import {
  CiphersuiteImpl,
  ClientState,
  clientStateDecoder,
  createGroup,
  Credential,
  decode,
  defaultCredentialTypes,
  defaultCryptoProvider,
  defaultExtensionTypes,
  generateKeyPackage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  RequiredCapabilities,
  unsafeTestingAuthenticationService,
} from "ts-mls"
import { encode as cborEncode } from "cbor-x"
import { clientConfig } from "./mlsConfig"
import { deriveGroupIdFromUserId } from "./mlsInteractions"
import {
  PostManifestPage,
  Manifest,
  PostManifest,
  FollowerGroupState,
  IndexManifest,
  IndexCollection,
} from "./manifest"
import {
  base64urlToUint8,
  RemoteStore,
  retrieveAndDecryptPostManifestPage,
  retrieveAndDecryptGroupState,
  retrieveAndDecryptManifest,
  uint8ToBase64Url,
  retrieveAndDecryptPostManifest,
} from "./remoteStore"
import { batchEncryptAndStoreWithSecrets, derivePostSecret } from "./createPost"
import {
  encodePostManifestPage,
  encodeFollowRequests,
  encodeClientState,
  encodeManifest,
  encodePostManifest,
  encodeFollowerGroupState,
} from "./codec/encode"
import { getRandomAvatar } from "@fractalsoftware/random-avatar-generator"
import { isDefaultCredential } from "ts-mls/credential.js"
import { getOwnLeafNode } from "ts-mls/clientState.js"

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
    credentialTypes: [defaultCredentialTypes.basic],
  }

  const kp = await generateKeyPackage({
    credential,
    cipherSuite: impl,
  })

  const groupId = await deriveGroupIdFromUserId(userId)

  const group = await createGroup({
    groupId,
    keyPackage: kp.publicPackage,
    privateKeyPackage: kp.privatePackage,
    extensions: [{ extensionType: defaultExtensionTypes.required_capabilities, extensionData: requiredCapabilities }],
    context: { cipherSuite: impl, authService: unsafeTestingAuthenticationService, clientConfig },
  })

  const keyPair = {
    signKey: kp.privatePackage.signaturePrivateKey,
    publicKey: kp.publicPackage.leafNode.signaturePublicKey,
  }
  return [group, keyPair]
}

export function createCredential(userId: string): Credential {
  return { credentialType: defaultCredentialTypes.basic, identity: new TextEncoder().encode(userId) }
}

export function getUserIdFromCredential(cred: Credential): string {
  if (!isDefaultCredential(cred) || cred.credentialType !== defaultCredentialTypes.basic)
    throw new Error("Wrong cred type")

  return new TextDecoder().decode(cred.identity)
}

export function getKeyPairFromGroupState(state: ClientState): SignatureKeyPair {
  return {
    signKey: state.signaturePrivateKey,
    publicKey: getOwnLeafNode(state).signaturePublicKey,
  }
}

export async function getOrCreateManifest(
  userId: string,
  manifestId: string,
  masterKey: Uint8Array,
  rs: RemoteStore,
): Promise<[Manifest, PostManifest, PostManifestPage, ClientState, SignatureKeyPair]> {
  const y = await retrieveAndDecryptManifest(rs, manifestId, masterKey)
  if (y) {
    const [[postManifest, page], followerGroupState] = await Promise.all([
      retrievePostManifestAndPage(rs, y),
      retrieveAndDecryptGroupState(rs, uint8ToBase64Url(await getGroupStateIdFromManifest(y, userId)), masterKey),
    ])

    const groupState = decode(clientStateDecoder, followerGroupState!.groupState)!

    return [y, postManifest!, page!, groupState, getKeyPairFromGroupState(groupState)]
  } else {
    const page: PostManifestPage = {
      pageIndex: 0,
      posts: [],
    }

    const [groupState, keyPair] = await initGroupState(userId)

    const followerGroupState: FollowerGroupState = {
      groupState: encodeClientState(groupState),
      cachedInteractions: new Map(),
    }

    const gmStorageId = crypto.getRandomValues(new Uint8Array(32))
    const frStorageId = crypto.getRandomValues(new Uint8Array(32))

    const impl = await getCiphersuiteImpl(
      getCiphersuiteFromName("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519"),
      defaultCryptoProvider,
    )

    const avatar = new TextEncoder().encode(getRandomAvatar(5, "circle"))

    const [manifest, postManifest, payloads] = await initManifest(
      groupState,
      impl,
      page,
      gmStorageId,
      frStorageId,
      masterKey,
      manifestId,
    )

    payloads.push(
      { postSecret: masterKey, storageId: gmStorageId, content: encodeFollowerGroupState(followerGroupState) },
      { postSecret: masterKey, storageId: frStorageId, content: encodeFollowRequests({ incoming: [], outgoing: [] }) },
    )

    await Promise.all([rs.client.putAvatar(avatar, "image/svg+xml"), batchEncryptAndStoreWithSecrets(rs, payloads)])

    return [manifest, postManifest, page, groupState, keyPair]
  }
}

export async function getGroupStateIdFromManifest(y: Manifest, userId: string): Promise<Uint8Array> {
  return y.groupStates.get(uint8ToBase64Url(await deriveGroupIdFromUserId(userId)))!
}

async function initManifest(
  groupState: ClientState,
  impl: CiphersuiteImpl,
  page: PostManifestPage,
  gmStorageId: Uint8Array,
  frStorageId: Uint8Array,
  masterKey: Uint8Array,
  manifestId: string,
): Promise<[Manifest, PostManifest, { postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }[]]> {
  const payloads: { postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }[] = []
  const [pm, pmStorage] = await initPostManifest(groupState, impl, page, payloads)
  const indexesStorage = await initIndexManifest(masterKey, payloads)

  const manifest: Manifest = {
    postManifest: pmStorage,
    indexes: indexesStorage,
    groupStates: new Map([[uint8ToBase64Url(groupState.groupContext.groupId), gmStorageId] as const]),
    followerManifests: new Map(),
    followRequests: frStorageId,
  }

  payloads.push({ postSecret: masterKey, storageId: base64urlToUint8(manifestId), content: encodeManifest(manifest) })

  return [manifest, pm, payloads]
}

async function initIndexManifest(
  masterKey: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }>,
): Promise<Uint8Array> {
  const emptyIndexes: IndexCollection = {
    byDistance: [],
    byDuration: [],
    byElevation: [],
    byType: new Map(),
    byGear: new Map(),
    wordIndex: new Map(),
    postLocator: new Map(),
    typeMap: new Map(),
    gearMap: new Map(),
  }

  // Create initial IndexManifest with random storage IDs
  const indexManifest: IndexManifest = {
    byDistance: uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    byDuration: uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    byElevation: uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    byType: uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    byGear: uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    wordIndex: uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    postLocator: uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(32))),
    typeMap: emptyIndexes.typeMap,
    gearMap: emptyIndexes.gearMap,
  }

  const indexManifestId = crypto.getRandomValues(new Uint8Array(32))

  const newIndexManifest: IndexManifest = {
    ...indexManifest,
    typeMap: emptyIndexes.typeMap,
    gearMap: emptyIndexes.gearMap,
  }

  payloads.push(
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byDistance),
      content: cborEncode(emptyIndexes.byDistance),
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byDuration),
      content: cborEncode(emptyIndexes.byDuration),
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byElevation),
      content: cborEncode(emptyIndexes.byElevation),
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byType),
      content: cborEncode(emptyIndexes.byType),
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byGear),
      content: cborEncode(emptyIndexes.byGear),
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.wordIndex),
      content: cborEncode(emptyIndexes.wordIndex),
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.postLocator),
      content: cborEncode(emptyIndexes.postLocator),
    },
    { postSecret: masterKey, storageId: indexManifestId, content: cborEncode(newIndexManifest) },
  )

  return indexManifestId
}

async function initPostManifest(
  groupState: ClientState,
  impl: CiphersuiteImpl,
  page: PostManifestPage,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array }>,
): Promise<[PostManifest, [string, Uint8Array]]> {
  const postSecret = await derivePostSecret(groupState, impl)

  const pageObjectId = crypto.getRandomValues(new Uint8Array(32))
  const pageStorage: [string, Uint8Array] = [uint8ToBase64Url(pageObjectId), postSecret]

  payloads.push({ postSecret, storageId: pageObjectId, content: encodePostManifestPage(page) })

  const postManifest: PostManifest = {
    pages: [],
    currentPage: pageStorage,
    totals: {
      totalPosts: 0,
      totalDerivedMetrics: {
        distance: 0,
        elevation: 0,
        duration: 0,
      },
    },
  }

  const postManifestObjectId = crypto.getRandomValues(new Uint8Array(32))
  const postManifestStorage: [string, Uint8Array] = [uint8ToBase64Url(postManifestObjectId), postSecret]

  payloads.push({ postSecret, storageId: postManifestObjectId, content: encodePostManifest(postManifest) })

  return [postManifest, postManifestStorage] as const
}

async function retrievePostManifestAndPage(
  rs: RemoteStore,
  y: Manifest,
): Promise<[PostManifest | undefined, PostManifestPage | undefined]> {
  const postManifest = await retrieveAndDecryptPostManifest(rs, y.postManifest)
  const page = await retrieveAndDecryptPostManifestPage(rs, postManifest!.currentPage)
  return [postManifest, page]
}
