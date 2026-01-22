import { describe, it, expect } from "vitest"
import { decode, clientStateDecoder } from "ts-mls"

import { initGroupState } from "../src/init.js"
import { encodeClientState } from "../src/codec/encode.js"

describe("initGroupState", () => {
  it("produces a ClientState encodable via encodeClientState", async () => {
    const userId = `test-user-${Date.now()}`

    const [state, keyPair] = await initGroupState(userId)

    expect(state).toBeDefined()
    expect(keyPair.signKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.signKey.length).toBeGreaterThan(0)
    expect(keyPair.publicKey.length).toBeGreaterThan(0)

    const encoded = encodeClientState(state)
    expect(encoded).toBeInstanceOf(Uint8Array)
    expect(encoded.length).toBeGreaterThan(0)

    const decoded = decode(clientStateDecoder, encoded)
    expect(decoded).toBeDefined()
    expect(decoded!.groupContext.groupId).toEqual(state.groupContext.groupId)
  })
})
