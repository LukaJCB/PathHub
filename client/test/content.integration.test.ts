import { describe, it, expect, beforeAll } from "vitest"
import { createAuthClient } from "../src/authClient.js"
import { createContentClient } from "../src/http/storageClient.js"
import { base64urlToUint8, uint8ToBase64Url } from "../src/remoteStore.js"

const authBaseUrl = "http://localhost:3000"
const contentBaseUrl = "http://localhost:3000"

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

    const objectId = uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
    const body = crypto.getRandomValues(new Uint8Array(32))
    const nonce = crypto.getRandomValues(new Uint8Array(16))

    await contentClient.putContent(objectId, body, nonce)

    const fetched = await contentClient.batchGetContent([base64urlToUint8(objectId)])

    const entry = fetched[objectId]
    expect(entry).toBeDefined()
    expect(new Uint8Array(entry!.body)).toEqual(new Uint8Array(body))
    expect(entry!.nonce).toBe(uint8ToBase64Url(nonce))
  })

  it("uploads multiple blobs with batchPut and retrieves them via batch", async () => {
    const contentClient = createContentClient(contentBaseUrl, token)

    const id1 = uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
    const id2 = uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
    const body1 = crypto.getRandomValues(new Uint8Array(24))
    const body2 = crypto.getRandomValues(new Uint8Array(28))
    const nonce1 = crypto.getRandomValues(new Uint8Array(12))
    const nonce2 = crypto.getRandomValues(new Uint8Array(14))

    await contentClient.batchPut([
      { id: id1, body: body1, nonce: nonce1 },
      { id: id2, body: body2, nonce: nonce2 },
    ])

    const fetched = await contentClient.batchGetContent([base64urlToUint8(id1), base64urlToUint8(id2)])

    const e1 = fetched[id1]
    const e2 = fetched[id2]

    expect(e1).toBeDefined()
    expect(e2).toBeDefined()
    expect(new Uint8Array(e1!.body)).toEqual(new Uint8Array(body1))
    expect(new Uint8Array(e2!.body)).toEqual(new Uint8Array(body2))
    expect(e1!.nonce).toBe(uint8ToBase64Url(nonce1))
    expect(e2!.nonce).toBe(uint8ToBase64Url(nonce2))
  })
})
