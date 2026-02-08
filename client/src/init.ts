import {
  ClientState,
  createGroup,
  Credential,
  defaultCredentialTypes,
  defaultExtensionTypes,
  generateKeyPackage,
  getCiphersuiteImpl,
  MlsContext,
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
  Entity,
  newEntity,
  newEntityWithId,
  Payload,
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
  encodeManifest,
  encodePostManifest,
  encodeFollowerGroupState,
} from "./codec/encode"
import { getRandomAvatar } from "@fractalsoftware/random-avatar-generator"
import { isDefaultCredential } from "ts-mls"
import { getOwnLeafNode } from "ts-mls"
import { FollowRequests } from "./followRequest"

export interface SignatureKeyPair {
  signKey: Uint8Array
  publicKey: Uint8Array
}

export async function initMlsContext(): Promise<MlsContext> {
  const impl = await getCiphersuiteImpl("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")
  return { cipherSuite: impl, authService: unsafeTestingAuthenticationService, clientConfig }
}

export async function initGroupState(userId: string): Promise<[ClientState, SignatureKeyPair, MlsContext]> {
  const credential: Credential = createCredential(userId)
  const context = await initMlsContext()

  const requiredCapabilities: RequiredCapabilities = {
    extensionTypes: [],
    proposalTypes: [],
    credentialTypes: [defaultCredentialTypes.basic],
  }

  const kp = await generateKeyPackage({
    credential,
    cipherSuite: context.cipherSuite,
  })

  const groupId = await deriveGroupIdFromUserId(userId)

  const group = await createGroup({
    groupId,
    keyPackage: kp.publicPackage,
    privateKeyPackage: kp.privatePackage,
    extensions: [{ extensionType: defaultExtensionTypes.required_capabilities, extensionData: requiredCapabilities }],
    context,
  })

  const keyPair = {
    signKey: kp.privatePackage.signaturePrivateKey,
    publicKey: kp.publicPackage.leafNode.signaturePublicKey,
  }
  return [group, keyPair, context]
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
): Promise<
  [
    Entity<Manifest>,
    Entity<PostManifest>,
    Entity<PostManifestPage>,
    Entity<FollowerGroupState>,
    SignatureKeyPair,
    MlsContext,
  ]
> {
  const y = await retrieveAndDecryptManifest(rs, manifestId, masterKey)
  if (y) {
    const [[postManifest, page], followerGroupState] = await Promise.all([
      retrievePostManifestAndPage(rs, y),
      retrieveAndDecryptGroupState(rs, uint8ToBase64Url(await getGroupStateIdFromManifest(y, userId)), masterKey),
    ])

    const groupState = followerGroupState!.groupState

    return [y, postManifest!, page!, followerGroupState!, getKeyPairFromGroupState(groupState), await initMlsContext()]
  } else {
    const [groupState, keyPair, mlsContext] = await initGroupState(userId)

    const impl = await getCiphersuiteImpl("MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519")

    const postSecret = await derivePostSecret(groupState, impl)

    const [pagePayload, page] = newEntity<PostManifestPage>(
      {
        pageIndex: 0,
        posts: [],
      },
      postSecret,
      encodePostManifestPage,
    )

    const [groupStatePayload, followerGroupState] = newEntity<FollowerGroupState>(
      {
        groupState: groupState,
        cachedInteractions: new Map(),
      },
      masterKey,
      encodeFollowerGroupState,
    )

    const [followRequestsPayload, followRequests] = newEntity<FollowRequests>(
      { incoming: [], outgoing: [] },
      masterKey,
      encodeFollowRequests,
    )

    const avatar = new TextEncoder().encode(getRandomAvatar(5, "circle"))

    const [manifest, postManifest, payloads] = await initManifest(
      groupState,
      postSecret,
      page,
      followerGroupState,
      followRequests,
      masterKey,
      manifestId,
    )

    payloads.push(pagePayload, groupStatePayload, followRequestsPayload)

    await Promise.all([rs.client.putAvatar(avatar, "image/svg+xml"), batchEncryptAndStoreWithSecrets(rs, payloads)])

    return [manifest, postManifest, page, followerGroupState, keyPair, mlsContext]
  }
}

export async function getGroupStateIdFromManifest(y: Manifest, userId: string): Promise<Uint8Array> {
  return y.groupStates.get(uint8ToBase64Url(await deriveGroupIdFromUserId(userId)))!
}

async function initManifest(
  groupState: ClientState,
  postSecret: Uint8Array,
  page: Entity<PostManifestPage>,
  followerGroupState: Entity<FollowerGroupState>,
  followRequests: Entity<FollowRequests>,
  masterKey: Uint8Array,
  manifestId: string,
): Promise<
  [
    Entity<Manifest>,
    Entity<PostManifest>,
    { postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }[],
  ]
> {
  const payloads: { postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }[] = []
  const [postManifest, postManifestPayload] = await initPostManifest(postSecret, page)
  const indexesStorage = await initIndexManifest(masterKey, payloads)

  console.log(page)

  const [manifestPayload, manifest] = newEntityWithId<Manifest>(
    {
      postManifest: postManifest.storage,
      indexes: indexesStorage,
      groupStates: new Map([
        [uint8ToBase64Url(groupState.groupContext.groupId), base64urlToUint8(followerGroupState.storage[0])] as const,
      ]),
      followerManifests: new Map(),
      followRequests: base64urlToUint8(followRequests.storage[0]),
    },
    masterKey,
    base64urlToUint8(manifestId),
    encodeManifest,
  )

  return [manifest, postManifest, [...payloads, postManifestPayload, manifestPayload]]
}

async function initIndexManifest(
  masterKey: Uint8Array,
  payloads: Array<{ postSecret: Uint8Array; storageId: Uint8Array; content: Uint8Array; version: bigint }>,
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
      version: 0n,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byDuration),
      content: cborEncode(emptyIndexes.byDuration),
      version: 0n,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byElevation),
      content: cborEncode(emptyIndexes.byElevation),
      version: 0n,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byType),
      content: cborEncode(emptyIndexes.byType),
      version: 0n,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.byGear),
      content: cborEncode(emptyIndexes.byGear),
      version: 0n,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.wordIndex),
      content: cborEncode(emptyIndexes.wordIndex),
      version: 0n,
    },
    {
      postSecret: masterKey,
      storageId: base64urlToUint8(indexManifest.postLocator),
      content: cborEncode(emptyIndexes.postLocator),
      version: 0n,
    },
    { postSecret: masterKey, storageId: indexManifestId, content: cborEncode(newIndexManifest), version: 0n },
  )

  return indexManifestId
}

async function initPostManifest(
  postSecret: Uint8Array,
  page: Entity<PostManifestPage>,
): Promise<[Entity<PostManifest>, Payload]> {
  const [payload, postManifest] = newEntity<PostManifest>(
    {
      pages: [],
      currentPage: page.storage,
      totals: {
        totalPosts: 0,
        totalDerivedMetrics: {
          distance: 0,
          elevation: 0,
          duration: 0,
        },
      },
    },
    postSecret,
    encodePostManifest,
  )

  return [postManifest, payload] as const
}

async function retrievePostManifestAndPage(
  rs: RemoteStore,
  y: Manifest,
): Promise<[Entity<PostManifest> | undefined, Entity<PostManifestPage> | undefined]> {
  const postManifest = await retrieveAndDecryptPostManifest(rs, y.postManifest)
  const page = await retrieveAndDecryptPostManifestPage(rs, postManifest!.currentPage)
  return [postManifest, page]
}
