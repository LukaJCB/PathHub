import { encode, decode } from "cbor-x"

export interface MessageClient {
  sendMessage(input: { payload: Uint8Array; recipients: string[] }): Promise<{ id: string }>

  receiveMessages(): Promise<
    {
      id: string
      sender: string
      payload: Uint8Array
    }[]
  >

  ackMessages(input: { messageIds: string[] }): Promise<void>
}

export function createMessageClient(baseUrl: string, authToken: string): MessageClient {
  const CBOR_HEADERS = {
    "Content-Type": "application/cbor",
    Accept: "application/cbor",
  }

  async function sendMessage(input: { payload: Uint8Array; recipients: string[] }): Promise<{ id: string }> {
    const { payload, recipients } = input
    const body = encode({ payload, recipients }) as BufferSource

    const res = await fetch(`${baseUrl}/messages`, {
      method: "POST",
      headers: {
        ...CBOR_HEADERS,
        Authorization: `Bearer ${authToken}`,
      },
      body,
    })

    if (res.status === 201) {
      const buffer = await res.arrayBuffer()
      return decode(new Uint8Array(buffer)) as { id: string }
    }

    if (res.status === 401) {
      throw new Error("Unauthorized")
    }

    throw new Error(`Unexpected status ${res.status} in sendMessage`)
  }

  async function receiveMessages(): Promise<
    {
      id: string
      sender: string
      payload: Uint8Array
    }[]
  > {
    const res = await fetch(`${baseUrl}/messages`, {
      method: "GET",
      headers: {
        Accept: "application/cbor",
        Authorization: `Bearer ${authToken}`,
      },
    })

    if (res.status === 401) {
      throw new Error("Unauthorized")
    }

    if (!res.ok) {
      throw new Error(`Unexpected status ${res.status} in receiveMessages`)
    }

    const buffer = await res.arrayBuffer()
    const decoded = decode(new Uint8Array(buffer)) as {
      id: string
      sender: string
      payload: Uint8Array
    }[]

    return decoded
  }

  async function ackMessages(input: { messageIds: string[] }): Promise<void> {
    const { messageIds } = input

    const res = await fetch(`${baseUrl}/messages/ack`, {
      method: "POST",
      headers: {
        ...CBOR_HEADERS,
        Authorization: `Bearer ${authToken}`,
      },
      body: encode({ messageIds }) as BufferSource,
    })

    if (res.status === 204) return

    const buffer = await res.arrayBuffer()

    if (res.status === 400 || res.status === 404) {
      const decoded = decode(new Uint8Array(buffer)) as { error: string }
      throw new Error(decoded.error)
    }

    if (res.status === 401) {
      throw new Error("Unauthorized")
    }

    throw new Error(`Unexpected status ${res.status} in ackMessages`)
  }

  return {
    sendMessage,
    receiveMessages,
    ackMessages,
  }
}
