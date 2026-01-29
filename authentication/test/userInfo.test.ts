import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { build } from "../src/app.js"
import { encode, decode } from "cbor-x"
import * as opaque from "@serenity-kit/opaque"
import { generateKeyPair } from "jose"
import { FastifyInstance } from "fastify"

const password = "securepass123"

export async function registerUser(app: FastifyInstance, username: string, signingKey: Uint8Array): Promise<string> {
  const { registrationRequest, clientRegistrationState } = opaque.client.startRegistration({ password })

  const res1 = await app.inject({
    method: "POST",
    url: "/auth/startRegistration",
    headers: {
      "Content-Type": "application/cbor",
      Accept: "application/cbor",
    },
    payload: encode({ username, registrationRequest }),
  })

  expect(res1.statusCode).toBe(200)
  const { response: registrationResponse } = decode(res1.rawPayload)

  const { registrationRecord } = opaque.client.finishRegistration({
    registrationResponse,
    clientRegistrationState,
    password,
  })

  const finishRegBody = {
    username,
    registrationRecord,
    encryptedMasterKey: new Uint8Array([1, 2, 3]),
    masterKeyNonce: new Uint8Array([4, 5, 6]),
    encryptedRecoveryKey: new Uint8Array([7, 8, 9]),
    recoveryKeyNonce: new Uint8Array([10, 11, 12]),
    passwordEncryptedMasterKey: new Uint8Array([1, 2, 3]),
    passwordMasterKeyNonce: new Uint8Array([1, 2, 3]),
    salt: new Uint8Array([1, 2, 3]),
    signingPublicKey: signingKey,
  }

  const res2 = await app.inject({
    method: "POST",
    url: "/auth/finishRegistration",
    headers: {
      "Content-Type": "application/cbor",
      Accept: "application/cbor",
    },
    payload: encode(finishRegBody),
  })

  expect(res2.statusCode).toBe(201)
  const { userId } = decode(res2.rawPayload)
  return userId
}

export async function loginUser(app: FastifyInstance, username: string): Promise<string> {
  const { startLoginRequest, clientLoginState } = opaque.client.startLogin({ password })

  const res1 = await app.inject({
    method: "POST",
    url: "/auth/startLogin",
    headers: {
      "Content-Type": "application/cbor",
      Accept: "application/cbor",
    },
    payload: encode({ username, startLoginRequest }),
  })

  expect(res1.statusCode).toBe(200)
  const { response: loginResponse } = decode(res1.rawPayload)

  const { finishLoginRequest } = opaque.client.finishLogin({
    loginResponse,
    clientLoginState,
    password,
  })!

  const res2 = await app.inject({
    method: "POST",
    url: "/auth/finishLogin",
    headers: {
      "Content-Type": "application/cbor",
      Accept: "application/cbor",
    },
    payload: encode({ username, finishLoginRequest }),
  })

  expect(res2.statusCode).toBe(200)
  const { token } = decode(res2.rawPayload)
  return token
}

describe("/userInfo endpoint", () => {
  let app: FastifyInstance
  const serverSecret = opaque.server.createSetup()
  let privateKey: CryptoKey
  let publicKey: CryptoKey

  const username1 = `user1-${Date.now()}@example.com`
  const signingPublicKey1 = new Uint8Array([1, 2, 3, 4, 5])
  let userId1: string
  let token1: string

  const username2 = `user2-${Date.now()}@example.com`
  const signingPublicKey2 = new Uint8Array([6, 7, 8, 9, 10])
  let userId2: string

  const username3 = `user3-${Date.now()}@example.com`
  const signingPublicKey3 = new Uint8Array([11, 12, 13, 14, 15])
  let userId3: string

  afterAll(async () => {
    await app.close()
  })

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

    const user1Id = await registerUser(app, username1, signingPublicKey1)
    userId1 = user1Id
    token1 = await loginUser(app, username1)

    userId2 = await registerUser(app, username2, signingPublicKey2)

    userId3 = await registerUser(app, username3, signingPublicKey3)
  })

  it("should return user info for existing users", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode([userId1, userId2]),
    })

    expect(res.statusCode).toBe(200)
    const result = decode(res.rawPayload)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(2)

    const user1Info = result.find((u: any) => u.userid === userId1)
    const user2Info = result.find((u: any) => u.userid === userId2)

    expect(user1Info).toBeDefined()
    expect(user1Info.username).toBe(username1)
    expect(new Uint8Array(user1Info.key)).toEqual(signingPublicKey1)

    expect(user2Info).toBeDefined()
    expect(user2Info.username).toBe(username2)
    expect(new Uint8Array(user2Info.key)).toEqual(signingPublicKey2)
  })

  it("should return all requested users when all exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode([userId1, userId2, userId3]),
    })

    expect(res.statusCode).toBe(200)
    const result = decode(res.rawPayload)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(3)

    const user1Info = result.find((u: any) => u.userid === userId1)
    expect(user1Info).toBeDefined()
    expect(user1Info.username).toBe(username1)
    expect(new Uint8Array(user1Info.key)).toEqual(signingPublicKey1)

    const user2Info = result.find((u: any) => u.userid === userId2)
    expect(user2Info).toBeDefined()
    expect(user2Info.username).toBe(username2)
    expect(new Uint8Array(user2Info.key)).toEqual(signingPublicKey2)

    const user3Info = result.find((u: any) => u.userid === userId3)
    expect(user3Info).toBeDefined()
    expect(user3Info.username).toBe(username3)
    expect(new Uint8Array(user3Info.key)).toEqual(signingPublicKey3)
  })

  it("should return 404 when no users exist", async () => {
    const nonExistentId = crypto.randomUUID()

    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode([nonExistentId]),
    })

    expect(res.statusCode).toBe(404)
  })

  it("should return 404 when requesting multiple non-existent users", async () => {
    const nonExistentId1 = crypto.randomUUID()
    const nonExistentId2 = crypto.randomUUID()

    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode([nonExistentId1, nonExistentId2]),
    })

    expect(res.statusCode).toBe(404)
  })

  it("should return 401 when no authorization token is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode([userId1]),
    })

    expect(res.statusCode).toBe(401)
  })

  it("should return 401 when invalid authorization token is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: "Bearer invalid.token.here",
      },
      payload: encode([userId1]),
    })

    expect(res.statusCode).toBe(401)
  })

  it("should search users by username substring (case-insensitive)", async () => {
    const query = username2.toUpperCase()
    const res = await app.inject({
      method: "POST",
      url: "/auth/searchUsers",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode({ query, limit: 50 }),
    })

    expect(res.statusCode).toBe(200)
    const result = decode(res.rawPayload)

    expect(Array.isArray(result)).toBe(true)
    const usernames = result.map((u: any) => u.username)
    expect(usernames).toContain(username2)
    expect(usernames).not.toContain(username1)
  })

  it("should return partial results when some users exist", async () => {
    const nonExistentId = crypto.randomUUID()

    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode([userId1, nonExistentId]),
    })

    expect(res.statusCode).toBe(200)
    const result = decode(res.rawPayload)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)
    expect(result[0].userid).toBe(userId1)
  })

  it("should return 200 with one existing user when one exists and one does not", async () => {
    const nonExistentId = crypto.randomUUID()

    const res = await app.inject({
      method: "POST",
      url: "/auth/userInfo",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode([userId2, nonExistentId]),
    })

    expect(res.statusCode).toBe(200)
    const result = decode(res.rawPayload)

    expect(Array.isArray(result)).toBe(true)
    expect(result.length).toBe(1)

    const user2Info = result[0]
    expect(user2Info.userid).toBe(userId2)
    expect(user2Info.username).toBe(username2)
    expect(new Uint8Array(user2Info.key)).toEqual(signingPublicKey2)
  })
})

describe("/lookupUser endpoint", () => {
  let app: FastifyInstance
  const serverSecret = opaque.server.createSetup()
  let privateKey: CryptoKey
  let publicKey: CryptoKey

  const username1 = `lookup-user1-${Date.now()}@example.com`
  const signingPublicKey1 = new Uint8Array([20, 21, 22, 23, 24])
  let userId1: string
  let token1: string

  const username2 = `lookup-user2-${Date.now()}@example.com`
  const signingPublicKey2 = new Uint8Array([25, 26, 27, 28, 29])
  let userId2: string

  afterAll(async () => {
    await app.close()
  })

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

    const user1Id = await registerUser(app, username1, signingPublicKey1)
    userId1 = user1Id
    token1 = await loginUser(app, username1)

    userId2 = await registerUser(app, username2, signingPublicKey2)
  })

  it("should successfully lookup user by username", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/lookupUser",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode({ username: username2 }),
    })

    expect(res.statusCode).toBe(200)
    const result = decode(res.rawPayload)

    expect(result.username).toBe(username2)
    expect(result.userid).toBe(userId2)
    expect(new Uint8Array(result.key)).toEqual(signingPublicKey2)
  })

  it("should return 404 when looking up non-existent username", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/lookupUser",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode({ username: "nonexistent@example.com" }),
    })

    expect(res.statusCode).toBe(404)
  })

  it("should return 401 when no authorization token is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/lookupUser",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username: username1 }),
    })

    expect(res.statusCode).toBe(401)
  })

  it("should return 401 when invalid authorization token is provided", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/lookupUser",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: "Bearer invalid.token.here",
      },
      payload: encode({ username: username1 }),
    })

    expect(res.statusCode).toBe(401)
  })

  it("should lookup own user by username", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/lookupUser",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
        Authorization: `Bearer ${token1}`,
      },
      payload: encode({ username: username1 }),
    })

    expect(res.statusCode).toBe(200)
    const result = decode(res.rawPayload)

    expect(result.username).toBe(username1)
    expect(result.userid).toBe(userId1)
    expect(new Uint8Array(result.key)).toEqual(signingPublicKey1)
  })
})
