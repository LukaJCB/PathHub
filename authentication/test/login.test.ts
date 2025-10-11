import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { build } from "../src/app.js"
import { encode, decode } from "cbor-x"
import * as opaque from "@serenity-kit/opaque"
import { createLocalJWKSet, generateKeyPair, jwtVerify } from "jose"
import { FastifyInstance } from "fastify"

describe("Registration + login flow", () => {
  let app: FastifyInstance
  const serverSecret = opaque.server.createSetup()
  let privateKey: CryptoKey
  let publicKey: CryptoKey


  const username = `testuser@example.com-${Date.now()}`
  const password = "securepass123"
  let userId: string 

  afterAll(async () => {
    await app.close()
  })

  beforeAll(async () => {
    const { publicKey: pub, privateKey: priv } = await generateKeyPair("EdDSA")
    const keyId = crypto.randomUUID()
    privateKey = priv
    publicKey = pub
    app = await build(
      serverSecret,
      "postgres://postgres:postgres@localhost:5432/postgres",
      privateKey,
      publicKey,
      keyId,
    )
    //register a user

    const { registrationRequest, clientRegistrationState } = opaque.client.startRegistration({ password })

    const res1 = await app.inject({
      method: "POST",
      url: "/startRegistration",
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
      signingPublicKey: new Uint8Array([13, 14, 15]),
    }

    const res2 = await app.inject({
      method: "POST",
      url: "/finishRegistration",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode(finishRegBody),
    })

    userId = decode(res2.rawPayload).userId

  })

  it("should respond identically for existing and non-existing users in startLogin", async () => {
    const knownUser = username
    const unknownUser = "nobody@nowhere.com"

    const { startLoginRequest } = opaque.client.startLogin({ password })

    const knownRes = await app.inject({
      method: "POST",
      url: "/startLogin",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username: knownUser, startLoginRequest }),
    })

    const unknownRes = await app.inject({
      method: "POST",
      url: "/startLogin",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username: unknownUser, startLoginRequest }),
    })

    expect(knownRes.statusCode).toBe(200)
    expect(unknownRes.statusCode).toBe(200)

    expect(knownRes.rawPayload.length).toBe(unknownRes.rawPayload.length)
  })

  it("returns valid JWT and can be verified via JWKS", async () => {
    const { startLoginRequest, clientLoginState } = opaque.client.startLogin({ password })

    const res1 = await app.inject({
      method: "POST",
      url: "/startLogin",
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
      url: "/finishLogin",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username, finishLoginRequest }),
    })

    expect(res2.statusCode).toBe(200)
    const { token: receivedToken } = decode(res2.rawPayload)
    expect(receivedToken).toBeDefined()
    const token = receivedToken

    const jwks = await app.inject({
      method: "GET",
      url: "/.well-known/jwks.json",
    })

    expect(jwks.statusCode).toBe(200)

    const localJwks = createLocalJWKSet(jwks.json())

    const verified = await jwtVerify(token, localJwks, {
      algorithms: ["EdDSA"],
    })

    expect(verified.payload['ph-user']).toBe(username)
    expect(verified.payload.sub).toBeDefined
    expect(verified.payload.sub).toBe(userId)
    
  })

  it("fails identically if finishLoginRequest is invalid or user doesn't exist", async () => {
    const finishLoginRequest = Buffer.from(crypto.getRandomValues(new Uint8Array(64)))
      .toString("base64")
      .replace(/=+$/, "")

    const res = await app.inject({
      method: "POST",
      url: "/finishLogin",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username, finishLoginRequest }),
    })

    expect(res.statusCode).toBe(401)
    expect(decode(res.rawPayload)).toEqual({})

    const fakeUsername = "no-such-user@example.com"
    const finishLoginRequest2 = Buffer.from(crypto.getRandomValues(new Uint8Array(64)))
      .toString("base64")
      .replace(/=+$/, "")

    const res2 = await app.inject({
      method: "POST",
      url: "/finishLogin",
      headers: {
        "Content-Type": "application/cbor",
        Accept: "application/cbor",
      },
      payload: encode({ username: fakeUsername, finishLoginRequest: finishLoginRequest2 }),
    })

    expect(res2.statusCode).toBe(401)
    expect(decode(res2.rawPayload)).toEqual({})

    expect(res2.body).toBe(res.body)
  })
})
