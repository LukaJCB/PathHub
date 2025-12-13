import { describe, it, expect, beforeAll } from "vitest"

import { createAuthClient } from "../src/authClient.js"
import { createMessageClient } from "../src/http/messageClient.js"

const authBaseUrl = "http://localhost:3000"
const messagingBaseUrl = "http://localhost:3001"

describe("Authentication + Messaging End-to-End", () => {
  const authClient = createAuthClient(authBaseUrl)

  const userA = {
    username: `usera+${Date.now()}@example.com`,
    password: "secretA123!",
  }

  const userB = {
    username: `userb+${Date.now()}@example.com`,
    password: "secretB123!",
  }

  let userAId: string
  let userBId: string

  let tokenA: string
  let tokenB: string

  beforeAll(async () => {
    const resA = await authClient.register(userA)
    userAId = resA.userId

    const resB = await authClient.register(userB)
    userBId = resB.userId

    const loginA = await authClient.login(userA)
    tokenA = loginA.token

    const loginB = await authClient.login(userB)
    tokenB = loginB.token
  })

  it("User A sends a message to User B; B receives and acks it", async () => {
    const clientA = createMessageClient(messagingBaseUrl, `Bearer ${tokenA}`)
    const clientB = createMessageClient(messagingBaseUrl, `Bearer ${tokenB}`)

    const payload = new Uint8Array([1, 2, 3, 4, 5])

    const sent = await clientA.sendMessage({
      payload,
      recipients: [userBId],
    })

    expect(sent.id).toBeDefined()

    const received = await clientB.receiveMessages()

    expect(received.length).toBeGreaterThan(0)

    const found = received.find((msg) => msg.id === sent.id)

    expect(found).toBeDefined()
    expect(found!.payload).toEqual(payload)
    expect(found!.sender).toBe(userAId)

    await clientB.ackMessages({ messageIds: [sent.id] })

    const afterAck = await clientB.receiveMessages()
    expect(afterAck.find((m) => m.id === sent.id)).toBeUndefined()
  })
})
