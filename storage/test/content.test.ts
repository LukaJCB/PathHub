import { describe, it, beforeAll, expect } from "vitest"
import { build } from "../src/app.js"
import { encode, decode } from "cbor-x"
import { randomBytes } from "crypto"
import { Buffer } from "buffer"
import { S3Client, CreateBucketCommand } from "@aws-sdk/client-s3"
import { generateKeyPair, SignJWT } from "jose"
import { FastifyInstance } from "fastify"

const MINIO_ENDPOINT = "http://localhost:9000"
const BUCKET_NAME = "test-bucket"

const MINIO_ACCESS_KEY = "minioadmin"
const MINIO_SECRET_KEY = "minioadmin"

describe("MinIO content upload and fetch", () => {
  let app: FastifyInstance
  let privateKey: CryptoKey
  const testUserId = "123"
  const testUsername = "testuser"
  let token: string

  beforeAll(async () => {
    const { publicKey, privateKey: privKey } = await generateKeyPair("Ed25519")
    privateKey = privKey

    token = await new SignJWT({ sub: testUserId, ["ph-user"]: testUsername })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime("72h")
      .setIssuer("ph-auth")
      .sign(privateKey)

    const s3 = new S3Client({
      region: "us-east-1",
      endpoint: MINIO_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: MINIO_ACCESS_KEY,
        secretAccessKey: MINIO_SECRET_KEY,
      },
    })

    try {
      await s3.send(
        new CreateBucketCommand({
          Bucket: BUCKET_NAME,
        }),
      )
    } catch (e: any) {
      if (e.name !== "BucketAlreadyOwnedByYou") {
        throw e
      }
    }

    app = await build({
      minioEndpoint: MINIO_ENDPOINT,
      minioAccessKeyId: MINIO_ACCESS_KEY,
      minioSecretAccessKey: MINIO_SECRET_KEY,
      bucketName: BUCKET_NAME,
      publicKey,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  async function uploadRandomFile() {
    const objectId = Buffer.from(randomBytes(16))
    const objectIdString = objectId.toString("base64url")

    const binaryContent = Buffer.from("hello world")

    const nonce = randomBytes(16)
    const meta = {
      nonce,
    }

    const metaHeader = Buffer.from(encode(meta)).toString("base64url")

    const putResponse = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader,
      },
      payload: binaryContent,
    })
    return { putResponse, objectId, objectIdString, binaryContent }
  }

  it("should return 404 when fetching a non-existent objectId", async () => {
    const nonExistentObjectId = Buffer.from(randomBytes(16))
    const objectIdString = nonExistentObjectId.toString("base64url")

    const batchBody = encode([nonExistentObjectId])

    const batchResponse = await app.inject({
      method: "POST",
      url: "/content/batch",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: batchBody,
    })

    expect(batchResponse.statusCode).toBe(404)

    const decoded = decode(batchResponse.rawPayload)

    expect(decoded).toEqual({
      error: `Missing objectId: ${objectIdString}`,
    })
  })

  it("should upload single file and retrieve it via batch", async () => {
    const { putResponse, objectId, objectIdString, binaryContent } = await uploadRandomFile()

    expect(putResponse.statusCode).toBe(204)

    const batchBody = encode([objectId])
    const batchResponse = await app.inject({
      method: "POST",
      url: "/content/batch",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: batchBody,
    })

    expect(batchResponse.statusCode).toBe(200)

    const decoded = decode(batchResponse.rawPayload)
    const fetchedBuffer = decoded[objectIdString]

    expect(Buffer.compare(fetchedBuffer, binaryContent)).toBe(0)
  })

  it("should upload multiple files and retrieve them via batch", async () => {
    const { objectId: objId1, objectIdString: idStr1, binaryContent: content1 } = await uploadRandomFile()
    const { objectId: objId2, objectIdString: idStr2, binaryContent: content2 } = await uploadRandomFile()

    const batchBody = encode([objId1, objId2])
    const batchResponse = await app.inject({
      method: "POST",
      url: "/content/batch",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: batchBody,
    })

    expect(batchResponse.statusCode).toBe(200)

    const decoded = decode(batchResponse.rawPayload)
    const fetchedBuffer1 = decoded[idStr1]
    const fetchedBuffer2 = decoded[idStr2]

    expect(Buffer.compare(fetchedBuffer1, content1)).toBe(0)
    expect(Buffer.compare(fetchedBuffer2, content2)).toBe(0)
  })

  it("should return 404 when fetching a non-existent objectId alongside an existent id", async () => {
    const { objectId } = await uploadRandomFile()

    const nonExistentObjectId = Buffer.from(randomBytes(16))
    const nonExistentObjectIdString = nonExistentObjectId.toString("base64url")

    const batchBody = encode([objectId, nonExistentObjectId])

    const batchResponse = await app.inject({
      method: "POST",
      url: "/content/batch",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: batchBody,
    })

    expect(batchResponse.statusCode).toBe(404)

    const decoded = decode(batchResponse.rawPayload)

    expect(decoded).toEqual({
      error: `Missing objectId: ${nonExistentObjectIdString}`,
    })
  })

  it("should return 401 when token is missing or invalid", async () => {
    const objectId = Buffer.from(randomBytes(16)).toString("base64url")
    const binaryContent = Buffer.from("hello world")

    const nonce = randomBytes(16)
    const meta = {
      nonce,
    }
    const metaHeader = Buffer.from(encode(meta)).toString("base64url")

    const req = {
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader,
      },
      payload: binaryContent,
    } as const

    const res = await app.inject(req)

    expect(res.statusCode).toBe(401)

    const req2 = { ...req, headers: { ...req.headers, authorization: `Bearer ${metaHeader}` } }

    const res2 = await app.inject(req2)

    expect(res2.statusCode).toBe(401)
  })

  it("should return 400 when content-type is not application/octet-stream", async () => {
    const objectId = Buffer.from(randomBytes(16)).toString("base64url")
    const binaryContent = Buffer.from("hello world")

    const nonce = randomBytes(16)
    const meta = {
      nonce,
    }
    const metaHeader = Buffer.from(encode(meta)).toString("base64url")

    const res = await app.inject({
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
        "x-ph-meta": metaHeader,
      },
      payload: binaryContent,
    })

    expect(res.statusCode).toBe(400)
    const decoded = decode(res.rawPayload)
    expect(decoded).toEqual({ error: "Expected application/octet-stream" })
  })

  it("should return 400 when metadata header is missing", async () => {
    const objectId = Buffer.from(randomBytes(16)).toString("base64url")
    const binaryContent = Buffer.from("hello world")

    const res = await app.inject({
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      payload: binaryContent,
    })

    expect(res.statusCode).toBe(400)
  })

  it("should return 400 when metadata header is invalid", async () => {
    const objectId = Buffer.from(randomBytes(16)).toString("base64url")
    const binaryContent = Buffer.from("hello world")

    const metaHeader = Buffer.from("invalidcbor12").toString("base64url")

    const res = await app.inject({
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader,
      },
      payload: binaryContent,
    })

    expect(res.statusCode).toBe(400)
    const decoded = decode(res.rawPayload)
    expect(decoded).toEqual({ error: "Invalid metadata header" })
  })

  it("should allow update if object exists and is owned by same user", async () => {
    const objectId = Buffer.from(randomBytes(16))
    const objectIdString = objectId.toString("base64url")
    const binaryContent = Buffer.from("first content")

    const meta = {
      nonce: randomBytes(16),
    }
    const metaHeader = Buffer.from(encode(meta)).toString("base64url")

    const res1 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader,
      },
      payload: binaryContent,
    })
    expect(res1.statusCode).toBe(204)

    const meta2 = {
      nonce: randomBytes(16),
    }
    const metaHeader2 = Buffer.from(encode(meta2)).toString("base64url")
    const updatedBinaryFile = Buffer.from("overwrite")

    const res2 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader2,
      },
      payload: updatedBinaryFile,
    })

    expect(res2.statusCode).toBe(204)

    const batchBody = encode([objectId])
    const batchResponse = await app.inject({
      method: "POST",
      url: "/content/batch",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/cbor",
        accept: "application/cbor",
      },
      payload: batchBody,
    })

    expect(batchResponse.statusCode).toBe(200)

    const decoded2 = decode(batchResponse.rawPayload)
    const fetchedBuffer = decoded2[objectIdString]

    expect(Buffer.compare(fetchedBuffer, updatedBinaryFile)).toBe(0)
  })

  it("should return 403 if object exists and is owned by another user", async () => {
    const objectId = Buffer.from(randomBytes(16))
    const objectIdString = objectId.toString("base64url")
    const binaryContent = Buffer.from("first content")

    const meta = {
      nonce: randomBytes(16),
    }
    const metaHeader = Buffer.from(encode(meta)).toString("base64url")

    const res1 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader,
      },
      payload: binaryContent,
    })
    expect(res1.statusCode).toBe(204)

    const newToken = await new SignJWT({ sub: "456", ["ph-user"]: "bobby" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime("72h")
      .setIssuer("ph-auth")
      .sign(privateKey)

    const meta2 = {
      nonce: randomBytes(16),
    }
    const metaHeader2 = Buffer.from(encode(meta2)).toString("base64url")

    const res2 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${newToken}`,
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader2,
      },
      payload: Buffer.from("malicious overwrite"),
    })

    expect(res2.statusCode).toBe(403)
    const decoded = decode(res2.rawPayload)
    expect(decoded).toEqual({ error: "This object is restricted" })
  })

  it("should reject JWTs with alg: none", async () => {
    const header = {
      alg: "none",
      typ: "JWT",
    }
    const payload = {
      sub: "attacker",
      "ph-user": "hacker",
      iss: "ph-auth",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    }

    const base64url = (obj: object) => Buffer.from(JSON.stringify(obj)).toString("base64url")

    const unsignedToken = `${base64url(header)}.${base64url(payload)}.`

    const objectId = Buffer.from(randomBytes(16)).toString("base64url")
    const binaryContent = Buffer.from("hello world")

    const meta = {
      nonce: randomBytes(16),
    }
    const metaHeader = Buffer.from(encode(meta)).toString("base64url")

    const res = await app.inject({
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        authorization: `Bearer ${unsignedToken}`,
        "content-type": "application/octet-stream",
        "x-ph-meta": metaHeader,
      },
      payload: binaryContent,
    })

    expect(res.statusCode).toBe(401)
  })
})
