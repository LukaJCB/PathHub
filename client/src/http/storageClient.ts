import { encode, decode } from "cbor-x"
import { toBufferSource } from "ts-mls/util/byteArray.js";

export interface StorageClient {
  putContent(objectId: string, body: Uint8Array, accessKey: Uint8Array, nonce: Uint8Array): Promise<void>

  batchPut(payloads: Array<{ id: string; body: Uint8Array; nonce: Uint8Array }>): Promise<void>

  batchGetContent(objectIds: [Uint8Array, Uint8Array][]): Promise<Record<string, { body: Uint8Array; nonce: string }>>

  putAvatar(body: Uint8Array, contentType: "image/png" | "image/jpeg" | "image/svg+xml"): Promise<void>

  getAvatar(userId: string): Promise<{ body: Uint8Array; contentType: string } | undefined>
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

  async function batchPut(payloads: Array<{ id: string; body: Uint8Array; nonce: Uint8Array }>): Promise<void> {
    const headers = {
      "Content-Type": "application/octet-stream",
      Authorization: `Bearer ${authToken}`,
    }

    const encodedPayloads = payloads.map(p => ({
      id: p.id,
      body: p.body,
      nonce: uint8ToBase64Url(p.nonce)
    }))

    const res = await fetch(`${baseUrl}/content/batchPut`, {
      method: "POST",
      headers,
      body: encode(encodedPayloads) as BufferSource,
    })

    if (res.status === 204) {
      return
    }

    if (res.status === 400) {
      const errorBody = await res.arrayBuffer()
      const errorDecoded = decode(new Uint8Array(errorBody)) as { error: string }
      throw new Error(errorDecoded.error)
    }

    if (res.status === 401) {
      throw new Error("Unauthorized")
    }

    if (res.status === 403) {
      throw new Error("Forbidden: object is restricted")
    }

    throw new Error(`Unexpected status ${res.status} on batchPut`)
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

  async function putAvatar(body: Uint8Array, contentType: "image/png" | "image/jpeg" | "image/svg+xml"): Promise<void> {
    const headers = {
      "Content-Type": contentType,
      Authorization: `Bearer ${authToken}`,
    }

    const res = await fetch(`${baseUrl}/avatar`, {
      method: "PUT",
      headers,
      body: toBufferSource(body),
    })

    if (res.ok) {
      return
    }

    if (res.status === 400) {
      const errorBody = await res.arrayBuffer()
      const errorDecoded = decode(new Uint8Array(errorBody)) as { error: string }
      throw new Error(errorDecoded.error)
    }

    if (res.status === 401) {
      throw new Error("Unauthorized")
    }

    throw new Error(`Unexpected status ${res.status} on putAvatar`)
  }

  async function getAvatar(userId: string): Promise<{ body: Uint8Array; contentType: string } | undefined> {
    const headers = {
      Authorization: `Bearer ${authToken}`,
    }

    const res = await fetch(`${baseUrl}/avatar/${encodeURIComponent(userId)}`, {
      method: "GET",
      headers,
    })

    if (res.status === 200) {
      const contentType = res.headers.get("content-type") ?? "application/octet-stream"
      const arrayBuffer = await res.arrayBuffer()
      return {
        body: new Uint8Array(arrayBuffer),
        contentType,
      }
    }

    if (res.status === 404) {
      return undefined
    }

    if (res.status === 401) {
      throw new Error("Unauthorized")
    }

    throw new Error(`Unexpected status ${res.status} on getAvatar`)
  }

  return {
    putContent,
    batchPut,
    batchGetContent,
    putAvatar,
    getAvatar,
  }
}

function uint8ToBase64Url(u8: Uint8Array) {
  return btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}