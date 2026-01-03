import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { build } from "../src/app.js"
import { encode, decode } from "cbor-x"
import { FastifyInstance } from "fastify"
import * as opaque from "@serenity-kit/opaque"
import { generateKeyPair } from "jose"

describe("Registration", () => {
  let app: FastifyInstance
  const serverSecret = opaque.server.createSetup()
  let privateKey: CryptoKey
  let publicKey: CryptoKey

  beforeAll(async () => {
    const { publicKey: pub, privateKey: priv } = await generateKeyPair("EdDSA")
    const keyId = crypto.randomUUID()
    privateKey = priv
    publicKey = pub
    app = await build({
      opaqueSecret: serverSecret,
      pgConnection: "postgres://postgres:postgres@localhost:5432/postgres",
      signingKey: privateKey,
      publicKey,
      publicKeyId: keyId,
      minioEndpoint: "http://localhost:9000",
      minioAccessKeyId: "minioadmin",
      minioSecretAccessKey: "minioadmin",
      bucketName: "test-bucket",
      bucketNamePublic: "test-bucket-public",
    })
  })

  afterAll(async () => {
    await app.close()
  })

  const url = "/startRegistration"

  const { registrationRequest } = opaque.client.startRegistration({ password: "password" })

  it("accepts valid CBOR and returns 200", async () => {
    const username = `Alice-user-${Date.now()}`
    const payload = { username, registrationRequest }
    const response = await app.inject({
      method: "POST",
      url: url,
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode(payload),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers["content-type"]).toBe("application/cbor")

    const decoded = decode(response.rawPayload)
    expect(decoded).toBeDefined
  })

  it("returns 400 if missing username", async () => {
    const payload = { registrationRequest }
    const response = await app.inject({
      method: "POST",
      url: url,
      headers: { "Content-Type": "application/cbor" },
      payload: encode(payload),
    })

    expect(response.statusCode).toBe(400)
  })

  it("returns 400 if missing registrationRequest", async () => {
    const payload = { username: "bob" }
    const response = await app.inject({
      method: "POST",
      url: url,
      headers: { "Content-Type": "application/cbor" },
      payload: encode(payload),
    })

    expect(response.statusCode).toBe(400)
  })

  it("returns 400 if username is wrong type", async () => {
    const payload = { username: [123, 234], registrationRequest }
    const response = await app.inject({
      method: "POST",
      url: url,
      headers: { "Content-Type": "application/cbor" },
      payload: encode(payload),
    })

    expect(response.statusCode).toBe(400)
  })

  it("returns 400 if registrationRequest is wrong format", async () => {
    const username = `existing-user-${Date.now()}`
    const payload = { username, registrationRequest: "deadbeef" }
    const response = await app.inject({
      method: "POST",
      url: url,
      headers: { "Content-Type": "application/cbor" },
      payload: encode(payload),
    })

    expect(response.statusCode).toBe(400)
  })

  it("returns 409 if the user already exists", async () => {
    const username = `existing-user-${Date.now()}`
    const password = "password"

    const { registrationRequest, clientRegistrationState: registrationState } = opaque.client.startRegistration({
      password,
    })

    const res1 = await app.inject({
      method: "POST",
      url: url,
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username, registrationRequest }),
    })

    expect(res1.statusCode).toBe(200)

    const { response: registrationResponse } = decode(res1.rawPayload) as {
      response: string
    }

    const { registrationRecord } = opaque.client.finishRegistration({
      password,
      registrationResponse,
      clientRegistrationState: registrationState,
    })

    const res2 = await app.inject({
      method: "POST",
      url: "/finishRegistration",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({
        username,
        registrationRecord,
        encryptedMasterKey: new Uint8Array([1, 2, 3]),
        masterKeyNonce: new Uint8Array([4, 5, 6]),
        encryptedRecoveryKey: new Uint8Array([7, 8, 9]),
        recoveryKeyNonce: new Uint8Array([10, 11, 12]),
        passwordEncryptedMasterKey: new Uint8Array([1, 2, 3]),
        passwordMasterKeyNonce: new Uint8Array([1, 2, 3]),
        salt: new Uint8Array([1, 2, 3]),
        signingPublicKey: new Uint8Array([13, 14, 15]),
      }),
    })

    expect(res2.statusCode).toBe(201)
    expect(decode(res2.rawPayload).userId).toBeDefined

    const res3 = await app.inject({
      method: "POST",
      url: "/startRegistration",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username, registrationRequest }),
    })

    expect(res3.statusCode).toBe(409)
  })
})
