import { describe, it, beforeAll, afterAll, expect } from "vitest"
import { FastifyInstance } from "fastify"
import { build } from "../src/app.js"
import { encode, decode } from "cbor-x"
import { generateKeyPair, SignJWT } from "jose"
import { randomBytes } from "crypto"

describe("Message broker", () => {
  let app: FastifyInstance
  let privateKey: CryptoKey
  let tokenA: string
  let tokenB: string

  const userA = { sub: crypto.randomUUID(), username: "alice" }
  const userB = { sub: crypto.randomUUID(), username: "bob" }

  beforeAll(async () => {
    const { publicKey, privateKey: priv } = await generateKeyPair("Ed25519")
    privateKey = priv

    tokenA = await new SignJWT({ sub: userA.sub, "ph-user": userA.username })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey)

    tokenB = await new SignJWT({ sub: userB.sub, "ph-user": userB.username })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey)

    app = await build({
      pgConnection: "postgres://postgres:postgres@localhost:5432/messages",
      messageTtlSeconds: 60,
      publicKey,
    })

    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it("should allow sending, receiving, and acknowledging messages", async () => {
    const payload = randomBytes(32)

    const sendRes = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({
        payload,
        recipients: [userB.sub],
      }),
    })

    expect(sendRes.statusCode).toBe(201)
    const { id: messageId } = decode(sendRes.rawPayload) as { id: string }
    expect(typeof messageId).toBe("string")

    const receiveRes = await app.inject({
      method: "GET",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenB}`,
        accept: "application/cbor",
      },
    })

    expect(receiveRes.statusCode).toBe(200)
    const receivedMessages = decode(receiveRes.rawPayload) as {
      id: string
      sender: string
      payload: Uint8Array
    }[]

    expect(receivedMessages.length).toBe(1)

    const receivedMessage = receivedMessages.at(0)!
    expect(receivedMessage.id).toBe(messageId)
    expect(receivedMessage.sender).toBe(userA.sub)
    expect(Buffer.compare(Buffer.from(receivedMessage.payload), payload)).toBe(0)

    const ackRes = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({
        messageIds: [messageId],
      }),
    })

    expect(ackRes.statusCode).toBe(204)

    // User B fetches again after acking and should receive nothing
    const secondReceiveRes = await app.inject({
      method: "GET",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenB}`,
        accept: "application/cbor",
      },
    })

    expect(secondReceiveRes.statusCode).toBe(200)
    const secondMessages = decode(secondReceiveRes.rawPayload) as any[]
    expect(secondMessages).toEqual([])
  })

  it("should return 401 for missing or invalid token", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        "content-type": "application/cbor",
      },
      payload: encode({ payload: randomBytes(10), recipients: [userB.sub] }),
    })
    expect(res1.statusCode).toBe(401)

    const res2 = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: "Bearer bad.token",
        "content-type": "application/cbor",
      },
      payload: encode({ payload: randomBytes(10), recipients: [userB.sub] }),
    })
    expect(res2.statusCode).toBe(401)
  })

  it("should return 400 for invalid payloads when sending messages", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({ recipients: [userB.sub] }),
    })
    expect(res1.statusCode).toBe(400)

    const res2 = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({ payload: randomBytes(10), recipients: [] }),
    })
    expect(res2.statusCode).toBe(400)

    const res3 = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({ payload: randomBytes(10), recipients: ["not-a-uuid"] }),
    })
    expect(res3.statusCode).toBe(400)
  })

  it("should return 400 when ack payload is missing or malformed", async () => {
    const res1 = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
      },
      payload: encode({}),
    })
    expect(res1.statusCode).toBe(400)

    const res2 = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
      },
      payload: encode({ messageIds: [] }),
    })
    expect(res2.statusCode).toBe(400)
  })

  it("should fail ack for non-existent message", async () => {
    const nonExistentMessageId = crypto.randomUUID()

    const res = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
      },
      payload: encode({ messageIds: [nonExistentMessageId] }),
    })

    expect(res.statusCode).toBe(404)
  })

  it("should not allow user to ack a message not sent to them", async () => {
    const payload = randomBytes(16)
    const sendRes = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({ payload, recipients: [userA.sub] }),
    })
    expect(sendRes.statusCode).toBe(201)

    const { id: messageId } = decode(sendRes.rawPayload) as { id: string }

    const res = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({ messageIds: [messageId] }),
    })

    expect(res.statusCode).toBe(404)

    // User A should still be able to fetch the message
    const receiveRes = await app.inject({
      method: "GET",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        accept: "application/cbor",
      },
    })

    const messages = decode(receiveRes.rawPayload) as any[]
    expect(messages.find((m) => m.id === messageId)).toBeTruthy()
  })

  it("should allow acking the same message twice without error", async () => {
    const payload = randomBytes(16)

    const sendRes = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({ payload, recipients: [userB.sub] }),
    })
    expect(sendRes.statusCode).toBe(201)
    const { id: messageId } = decode(sendRes.rawPayload) as { id: string }

    const ackRes1 = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
      },
      payload: encode({ messageIds: [messageId] }),
    })
    expect(ackRes1.statusCode).toBe(204)

    const ackRes2 = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
      },
      payload: encode({ messageIds: [messageId] }),
    })
    expect(ackRes2.statusCode).toBe(204)
  })

  it("should allow sending to multiple recipients", async () => {
    const userC = { sub: crypto.randomUUID(), username: "charlie" }
    const tokenC = await new SignJWT({ sub: userC.sub, "ph-user": userC.username })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt()
      .setExpirationTime("2h")
      .sign(privateKey)

    const payload = randomBytes(10)

    const sendRes = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({ payload, recipients: [userB.sub, userC.sub] }),
    })

    expect(sendRes.statusCode).toBe(201)
    const { id: messageId } = decode(sendRes.rawPayload) as { id: string }

    const resB = await app.inject({
      method: "GET",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenB}`,
        accept: "application/cbor",
      },
    })
    const resC = await app.inject({
      method: "GET",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenC}`,
        accept: "application/cbor",
      },
    })

    expect(decode(resB.rawPayload).some((m: any) => m.id === messageId)).toBe(true)
    expect(decode(resC.rawPayload).some((m: any) => m.id === messageId)).toBe(true)

    const ackResB = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenB}`,
        "content-type": "application/cbor",
      },
      payload: encode({ messageIds: [messageId] }),
    })
    expect(ackResB.statusCode).toBe(204)

    const ackResC = await app.inject({
      method: "POST",
      url: "/messages/ack",
      headers: {
        authorization: `Bearer ${tokenC}`,
        "content-type": "application/cbor",
      },
      payload: encode({ messageIds: [messageId] }),
    })
    expect(ackResC.statusCode).toBe(204)

    // User B fetches again after acking and should receive nothing
    const secondReceiveResB = await app.inject({
      method: "GET",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenB}`,
        accept: "application/cbor",
      },
    })

    expect(secondReceiveResB.statusCode).toBe(200)
    const secondMessagesB = decode(secondReceiveResB.rawPayload) as any[]
    expect(secondMessagesB).toEqual([])

    // User C fetches again after acking and should receive nothing
    const secondReceiveResC = await app.inject({
      method: "GET",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenC}`,
        accept: "application/cbor",
      },
    })

    expect(secondReceiveResC.statusCode).toBe(200)
    const secondMessagesC = decode(secondReceiveResC.rawPayload) as any[]
    expect(secondMessagesC).toEqual([])
  })

  it("should return 400 for invalid CBOR body", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/messages",
      headers: {
        authorization: `Bearer ${tokenA}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: encode({foo: 'bar'}),
    })

    console.log(res.body)
    expect(res.statusCode).toBe(400)
  })

})
