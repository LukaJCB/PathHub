import { encode, decode } from "cbor-x"

export interface StorageClient {
  putContent(objectId: string, body: Uint8Array, accessKey: Uint8Array, nonce: Uint8Array): Promise<void>

  batchGetContent(objectIds: [Uint8Array, Uint8Array][]): Promise<Record<string, { body: Uint8Array; nonce: string }>>
}

export function createContentClient(baseUrl: string, authToken: string): StorageClient {
  const defaultHeaders = {
    "Content-Type": "application/octet-stream",
    Accept: "application/cbor",
  }

  async function putContent(objectId: string, body: Uint8Array, accessKey: Uint8Array, nonce: Uint8Array): Promise<void> {
    const headers = {
      ...defaultHeaders,
      Authorization: `Bearer ${authToken}`,
      "x-ph-nonce": uint8ToBase64Url(nonce),
      "x-ph-access": uint8ToBase64Url(accessKey)
    }

    const res = await fetch(`${baseUrl}/content/${encodeURIComponent(objectId)}`, {
      method: "PUT",
      headers,
      body: body as BufferSource,
    })

    if (!res.ok) {
      console.log(await res.text())
      throw new Error(`Unexpected status ${res.status}`)
    }
  }

  async function batchGetContent(objectIds: [Uint8Array, Uint8Array][]): Promise<Record<string, { body: Uint8Array; nonce: string }>> {
    const headers = {
      "Content-Type": "application/cbor",
      Accept: "application/cbor",
      Authorization: `Bearer ${authToken}`,
    }

    const res = await fetch(`${baseUrl}/content/batch`, {
      method: "POST",
      headers,
      body: encode(objectIds) as BufferSource,
    })
 
    if (res.status === 200) {
      const arrayBuffer = await res.arrayBuffer()
      return decode(new Uint8Array(arrayBuffer)) as Record<string, { body: Uint8Array; nonce: string }>
    }

    if (res.status === 400 || res.status === 404) {
      const errorBody = await res.arrayBuffer()
      const errorDecoded = decode(new Uint8Array(errorBody)) as { error: string }
      throw new Error(errorDecoded.error)
    }

    if (res.status === 401) {
      throw new Error("Unauthorized")
    }

    throw new Error(`Unexpected status ${res.status} on batchGetContent`)
  }

  return {
    putContent,
    batchGetContent,
  }
}

function uint8ToBase64Url(u8: Uint8Array) {
  return btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}