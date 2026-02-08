import { encode, decode } from "cbor-x"
import { toBufferSource } from "ts-mls"
import { base64urlToUint8, uint8ToBase64Url } from "../remoteStore"

export interface StorageClient {
  putContent(objectId: string, body: Uint8Array, nonce: Uint8Array, version?: bigint): Promise<void>

  batchPut(
    payloads: Array<{ id: string; body: Uint8Array; nonce: Uint8Array; version?: bigint }>,
    extra?: Uint8Array,
  ): Promise<void>

  batchGetContent(
    objectIds: Uint8Array[],
  ): Promise<Record<string, { body: Uint8Array; nonce: string; version: bigint }>>

  putAvatar(body: Uint8Array, contentType: "image/png" | "image/jpeg" | "image/svg+xml"): Promise<void>

  getAvatar(userId: string): Promise<{ body: Uint8Array; contentType: string } | undefined>
}

export function createContentClient(baseUrl: string, authToken: string): StorageClient {
  async function putContent(objectId: string, body: Uint8Array, nonce: Uint8Array, version?: bigint): Promise<void> {
    return batchPut([{ id: objectId, body, nonce, version }])
  }

  async function batchPut(
    payloads: Array<{ id: string; body: Uint8Array; nonce: Uint8Array; version?: bigint }>,
    extra: Uint8Array = new Uint8Array(),
  ): Promise<void> {
    console.log(payloads)
    const headers = {
      "Content-Type": "application/octet-stream",
      Authorization: `Bearer ${authToken}`,
    }

    // [u32 magic][u16 version]
    // [u32 extra_len]
    // if extra_len > 0:
    //   [extra bytes]
    // repeat:
    //   [u16 nonce_len][nonce]
    //   [u16 id_len][id]
    //   [u64 version]
    //   [u64 blob_len][blob bytes]
    const magic = 0x00000001
    const version = 1

    let totalSize = 4 + 2 + 4 + extra.length
    const entries = payloads.map((p) => {
      const idBytes = base64urlToUint8(p.id)
      const nonceBytes = p.nonce instanceof Uint8Array ? p.nonce : new Uint8Array(p.nonce)
      const bodyBytes = p.body instanceof Uint8Array ? p.body : new Uint8Array(p.body)
      const size = 2 + nonceBytes.length + 2 + idBytes.length + 8 + 8 + bodyBytes.length
      const version = p.version ?? 0n
      totalSize += size
      return { idBytes, nonceBytes, bodyBytes, version }
    })

    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)
    const uint8 = new Uint8Array(buffer)

    let offset = 0
    view.setUint32(offset, magic)

    offset += 4
    view.setUint16(offset, version)
    offset += 2

    view.setUint32(offset, extra.byteLength)
    offset += 4
    uint8.set(extra, offset)
    offset += extra.byteLength

    for (const { idBytes, nonceBytes, bodyBytes, version } of entries) {
      view.setUint16(offset, nonceBytes.length)
      offset += 2
      uint8.set(nonceBytes, offset)
      offset += nonceBytes.length

      view.setUint16(offset, idBytes.length)
      offset += 2
      uint8.set(idBytes, offset)
      offset += idBytes.length

      view.setBigUint64(offset, version)
      offset += 8

      view.setBigUint64(offset, BigInt(bodyBytes.length))
      offset += 8
      uint8.set(bodyBytes, offset)
      offset += bodyBytes.length
    }

    const res = await fetch(`${baseUrl}/content/batch`, {
      method: "PUT",
      headers,
      body: buffer,
    })

    if (res.status === 204) return

    if (res.status === 400 || res.status === 403 || res.status === 412) {
      const errorBody = await res.arrayBuffer()
      try {
        const errorDecoded = decode(new Uint8Array(errorBody)) as { error: string; objectId: string }
        console.log(errorDecoded)
        const pl = payloads.find((p) => p.id === errorDecoded.objectId)
        console.log(pl)
        console.log(uint8ToBase64Url(pl!.body))
        const body = decode(pl!.body) as unknown
        console.log(body)
        throw new Error(errorDecoded.error)
      } catch (e) {
        throw new Error(new TextDecoder().decode(errorBody))
      }
    }

    if (res.status === 401) throw new Error("Unauthorized")

    throw new Error(`Unexpected status ${res.status} on batchPut`)
  }

  async function batchGetContent(
    objectIds: Uint8Array[],
  ): Promise<Record<string, { body: Uint8Array; nonce: string; version: bigint }>> {
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
      return decode(new Uint8Array(arrayBuffer)) as Record<string, { body: Uint8Array; nonce: string; version: bigint }>
    }

    if (res.status === 400 || res.status === 404) {
      const errorBody = await res.arrayBuffer()
      try {
        const errorDecoded = decode(new Uint8Array(errorBody)) as { error: string }
        throw new Error(errorDecoded.error)
      } catch (e) {
        const er = new TextDecoder().decode(errorBody)
        throw new Error(er)
      }
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

    const res = await fetch(`${baseUrl}/content/avatar`, {
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

    const res = await fetch(`${baseUrl}/content/avatar/${encodeURIComponent(userId)}`, {
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
