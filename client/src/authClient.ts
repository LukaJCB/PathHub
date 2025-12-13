import * as opaque from "@serenity-kit/opaque"
import { createAuthenticationClient } from "./http/authenticationClient.js"
import { scryptAsync } from "@noble/hashes/scrypt"
import { toBufferSource } from "ts-mls/util/byteArray.js";

export interface AuthenticationClient {
  register(input: { username: string; password: string }): Promise<{ userId: string }>

  login(input: { username: string; password: string }): Promise<{ token: string; manifest: string; masterKey: Uint8Array }>
}

async function generateMasterKeyRecoveryKeyPair() {
  const masterKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  )

  const recoveryKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  )

  return { recoveryKey, masterKey }
}

type EncryptedKeys = {
  encryptedMasterKey: Uint8Array
  masterKeyNonce: Uint8Array
  encryptedRecoveryKey: Uint8Array
  recoveryKeyNonce: Uint8Array
}

const masterKeyAad = new TextEncoder().encode("masterKeyAad")
const recoveryKeyAad = new TextEncoder().encode("recoveryKeyAad")

async function encryptKeys(recoveryKey: CryptoKey, masterKey: CryptoKey): Promise<EncryptedKeys> {
  const rawMasterKey = await crypto.subtle.exportKey("raw", masterKey)
  const rawRecoveryKey = await crypto.subtle.exportKey("raw", recoveryKey)

  // 96 bit nonces
  const masterKeyNonce = crypto.getRandomValues(new Uint8Array(12))
  const recoveryKeyNonce = crypto.getRandomValues(new Uint8Array(12))

  const encryptedMasterKey = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: masterKeyNonce, additionalData: masterKeyAad },
      recoveryKey,
      rawMasterKey,
    ),
  )
  const encryptedRecoveryKey = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: recoveryKeyNonce, additionalData: recoveryKeyAad },
      masterKey,
      rawRecoveryKey,
    ),
  )

  return { encryptedMasterKey, masterKeyNonce, encryptedRecoveryKey, recoveryKeyNonce }
}

const scryptConfig = { N: 16384, r: 8, p: 1, dkLen: 32 }
const masterKeyPasswordAad = new TextEncoder().encode("masterKeyPasswordAad")

type SetupPasswordResult = {
  passwordEncryptedMasterKey: Uint8Array
  passwordMasterKeyNonce: Uint8Array
  salt: Uint8Array
}

async function encryptMasterKeyPassword(masterKey: CryptoKey, password: string): Promise<SetupPasswordResult> {
  // 128 bit salt
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const pbkdfOutput = await scryptAsync(password, salt, scryptConfig)

  const imported = await crypto.subtle.importKey("raw", toBufferSource(pbkdfOutput), "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ])

  const rawMasterKey = await crypto.subtle.exportKey("raw", masterKey)

  // 96 bit nonce
  const passwordMasterKeyNonce = crypto.getRandomValues(new Uint8Array(12))
  const passwordEncryptedMasterKey = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: passwordMasterKeyNonce, additionalData: masterKeyPasswordAad },
      imported,
      rawMasterKey,
    ),
  )

  return { passwordEncryptedMasterKey, passwordMasterKeyNonce, salt }
}

async function decryptMasterKeyPassword(encryptedMasterKey: Uint8Array, password: string, salt: Uint8Array, masterKeyNonce: Uint8Array): Promise<Uint8Array> {

  const key = await scryptAsync(password, salt, scryptConfig);
  const imported = await crypto.subtle.importKey("raw", toBufferSource(key), "AES-GCM", true, ['decrypt'])


  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toBufferSource(masterKeyNonce), additionalData: masterKeyPasswordAad }, imported, toBufferSource(encryptedMasterKey)))
}


type PrivateKeyBundle = {
  signingKey: CryptoKey
  masterKey: CryptoKey
  recoveryKey: CryptoKey
}

export function createAuthClient(baseUrl: string): AuthenticationClient {
  const client = createAuthenticationClient(baseUrl)

  return {
    async register({ username, password }) {
      const { masterKey, recoveryKey } = await generateMasterKeyRecoveryKeyPair()

      const signKeyPair = await crypto.subtle.generateKey("Ed25519", false, ["sign", "verify"])

      const exportedSignaturePublicKey = await crypto.subtle.exportKey("raw", signKeyPair.publicKey)

      const encryptedKeys = await encryptKeys(recoveryKey, masterKey)

      const passwordSetupResult = await encryptMasterKeyPassword(masterKey, password)

      const { registrationRequest, clientRegistrationState } = opaque.client.startRegistration({ password })

      const startRegistrationResult = await client.startRegistration({ username, registrationRequest })

      const { registrationRecord } = opaque.client.finishRegistration({
        registrationResponse: startRegistrationResult.response,
        clientRegistrationState,
        password,
      })

      const result = await client.finishRegistration({
        ...encryptedKeys,
        ...passwordSetupResult,
        signingPublicKey: new Uint8Array(exportedSignaturePublicKey),
        username,
        registrationRecord,
      })

      const privateKeyBundle: PrivateKeyBundle = {
        signingKey: signKeyPair.privateKey,
        masterKey,
        recoveryKey,
      }

      return { status: "ok", userId: result.userId, privateKeyBundle }
    },

    async login({ username, password }) {

      const { startLoginRequest, clientLoginState } = opaque.client.startLogin({ password })

      const startLoginResult = await client.startLogin({ username, startLoginRequest })

      console.log(startLoginResult)

      const { finishLoginRequest } = opaque.client.finishLogin({
        loginResponse: startLoginResult.response,
        clientLoginState,
        password,
      })!

      const resp = await client.finishLogin({ username, finishLoginRequest })

      const masterKey = await decryptMasterKeyPassword(resp.encryptedMasterKey, password, resp.salt, resp.nonce)
      return {token: resp.token, manifest: resp.manifest, masterKey}
    },
  }
}
