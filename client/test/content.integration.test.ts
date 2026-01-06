import { describe, it, expect, beforeAll } from "vitest"
import { randomBytes } from "crypto"
import { createAuthClient } from "../src/authClient.js"
import { createContentClient } from "../src/http/storageClient.js"

const authBaseUrl = "http://localhost:3000"
const contentBaseUrl = "http://localhost:3000"

const toBase64Url = (u8: Uint8Array) => Buffer.from(u8).toString("base64url")

describe("Authentication + Content End-to-End", () => {
  const authClient = createAuthClient(authBaseUrl)

  const user = {
    username: `user+${Date.now()}@example.com`,
    password: "secretA123!",
  }

  let token: string

  beforeAll(async () => {
    const res = await authClient.register(user)
    expect(res.userId).toBeDefined()

    const login = await authClient.login(user)
    token = login.token
  })

  it("uploads a blob with new batch format and retrieves it", async () => {
    const contentClient = createContentClient(contentBaseUrl, token)

    const objectId = toBase64Url(randomBytes(16))
    const body = randomBytes(32)
    const nonce = randomBytes(16)

    await contentClient.putContent(objectId, body, nonce)

    const fetched = await contentClient.batchGetContent([Buffer.from(objectId, "base64url")])

    const entry = fetched[objectId]
    expect(entry).toBeDefined()
    expect(new Uint8Array(entry!.body)).toEqual(new Uint8Array(body))
    expect(entry!.nonce).toBe(toBase64Url(nonce))
  })

  it("uploads multiple blobs with batchPut and retrieves them via batch", async () => {
    const contentClient = createContentClient(contentBaseUrl, token)

    const id1 = toBase64Url(randomBytes(16))
    const id2 = toBase64Url(randomBytes(16))
    const body1 = randomBytes(24)
    const body2 = randomBytes(28)
    const nonce1 = randomBytes(12)
    const nonce2 = randomBytes(14)

    await contentClient.batchPut([
      { id: id1, body: body1, nonce: nonce1 },
      { id: id2, body: body2, nonce: nonce2 },
    ])

    const fetched = await contentClient.batchGetContent([
      Buffer.from(id1, "base64url"),
      Buffer.from(id2, "base64url"),
    ])

    const e1 = fetched[id1]
    const e2 = fetched[id2]

    expect(e1).toBeDefined()
    expect(e2).toBeDefined()
    expect(new Uint8Array(e1!.body)).toEqual(new Uint8Array(body1))
    expect(new Uint8Array(e2!.body)).toEqual(new Uint8Array(body2))
    expect(e1!.nonce).toBe(toBase64Url(nonce1))
    expect(e2!.nonce).toBe(toBase64Url(nonce2))
  })
})
