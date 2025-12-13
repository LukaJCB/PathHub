import {
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


export async function init(userId: string) {
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


