import { describe, it, beforeAll, afterAll, expect } from "vitest"
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
  let publicKey: CryptoKey
  const testUserId = "123"
  const testUsername = "testuser"
  let token: string

  beforeAll(async () => {
    const keypair = await generateKeyPair("Ed25519")
    publicKey = keypair.publicKey
    privateKey = keypair.privateKey

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
      opaqueSecret: "test-opaque-secret",
      pgConnection: "postgresql://postgres:postgres@localhost:5432/postgres",
      signingKey: privateKey,
      publicKey: publicKey,
      publicKeyId: "test-key-id",
      minioEndpoint: MINIO_ENDPOINT,
      minioAccessKeyId: MINIO_ACCESS_KEY,
      minioSecretAccessKey: MINIO_SECRET_KEY,
      bucketName: BUCKET_NAME,
      bucketNamePublic: BUCKET_NAME,
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
    const accessKey = randomBytes(32)

    const nonceHeader = Buffer.from(nonce).toString("base64url")
    const accessKeyHeader = Buffer.from(accessKey).toString("base64url")

    const putResponse = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-nonce": nonceHeader,
        "x-ph-access": accessKeyHeader,
      },
      payload: binaryContent,
    })
    return { putResponse, objectId, objectIdString, binaryContent, nonceHeader, accessKey }
  }

  it("should return 404 when fetching a non-existent objectId", async () => {
    const nonExistentObjectId = Buffer.from(randomBytes(16))
    const objectIdString = nonExistentObjectId.toString("base64url")

    const batchBody = encode([[nonExistentObjectId, nonExistentObjectId] as const])

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
    const { putResponse, objectId, objectIdString, nonceHeader, binaryContent, accessKey } = await uploadRandomFile()

    expect(putResponse.statusCode).toBe(204)

    const batchBody = encode([[objectId, accessKey] as const])
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
    const fetched = decoded[objectIdString]

    expect(Buffer.compare(fetched.body, binaryContent)).toBe(0)
    expect(nonceHeader).toBe(fetched.nonce)
  })

  it("should upload multiple files and retrieve them via batch", async () => {
    const {
      objectId: objId1,
      objectIdString: idStr1,
      binaryContent: content1,
      accessKey: accessKey1,
      nonceHeader: nonceHeader1,
    } = await uploadRandomFile()
    const {
      objectId: objId2,
      objectIdString: idStr2,
      binaryContent: content2,
      accessKey: accessKey2,
      nonceHeader: nonceHeader2,
    } = await uploadRandomFile()

    const batchBody = encode([
      [objId1, accessKey1],
      [objId2, accessKey2],
    ])
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
    const fetched1 = decoded[idStr1]
    const fetched2 = decoded[idStr2]

    expect(Buffer.compare(fetched1.body, content1)).toBe(0)
    expect(Buffer.compare(fetched2.body, content2)).toBe(0)
    expect(nonceHeader1).toBe(fetched1.nonce)
    expect(nonceHeader2).toBe(fetched2.nonce)
  })

  it("should return 404 when fetching a non-existent objectId alongside an existent id", async () => {
    const { objectId, accessKey } = await uploadRandomFile()

    const nonExistentObjectId = Buffer.from(randomBytes(16))
    const nonExistentObjectIdString = nonExistentObjectId.toString("base64url")

    const batchBody = encode([
      [objectId, accessKey],
      [nonExistentObjectId, nonExistentObjectId],
    ])

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
    const nonceHeader = Buffer.from(nonce).toString("base64url")

    const accessKey = randomBytes(16)
    const accessKeyHeader = Buffer.from(accessKey).toString("base64url")

    const req = {
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        "content-type": "application/octet-stream",
        "x-ph-nonce": nonceHeader,
        "x-ph-access": accessKeyHeader,
      },
      payload: binaryContent,
    } as const

    const res = await app.inject(req)

    expect(res.statusCode).toBe(401)

    const req2 = { ...req, headers: { ...req.headers, authorization: `Bearer ${randomBytes(16)}` } }

    const res2 = await app.inject(req2)

    expect(res2.statusCode).toBe(401)
  })

  it("should return 400 when content-type is not application/octet-stream", async () => {
    const objectId = Buffer.from(randomBytes(16)).toString("base64url")
    const binaryContent = Buffer.from("hello world")

    const nonce = randomBytes(16)
    const nonceHeader = Buffer.from(nonce).toString("base64url")

    const accessKey = randomBytes(16)
    const accessKeyHeader = Buffer.from(accessKey).toString("base64url")

    const res = await app.inject({
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
        "x-ph-nonce": nonceHeader,
        "x-ph-access": accessKeyHeader,
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

  it("should return 404 when accessKey is invalid", async () => {
    const { putResponse, objectId } = await uploadRandomFile()

    expect(putResponse.statusCode).toBe(204)

    const invalidKeyToken = randomBytes(32)

    const batchBody = encode([[objectId, invalidKeyToken] as const])
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
  })

  it("should allow update if object exists and is owned by same user", async () => {
    const objectId = Buffer.from(randomBytes(16))
    const objectIdString = objectId.toString("base64url")
    const binaryContent = Buffer.from("first content")

    const nonce = randomBytes(16)
    const nonceHeader = Buffer.from(nonce).toString("base64url")

    const accessKey = randomBytes(32)
    const accessKeyHeader = Buffer.from(accessKey).toString("base64url")

    const res1 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-nonce": nonceHeader,
        "x-ph-access": accessKeyHeader,
      },
      payload: binaryContent,
    })
    expect(res1.statusCode).toBe(204)

    const nonce2 = randomBytes(16)
    const nonceHeader2 = Buffer.from(nonce2).toString("base64url")

    const accessKey2 = randomBytes(32)
    const accessKeyHeader2 = Buffer.from(accessKey2).toString("base64url")

    const updatedBinaryFile = Buffer.from("overwrite")

    const res2 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-nonce": nonceHeader2,
        "x-ph-access": accessKeyHeader2,
      },
      payload: updatedBinaryFile,
    })

    expect(res2.statusCode).toBe(204)

    const batchBody = encode([[objectId, accessKey2]])
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
    const fetched = decoded2[objectIdString]

    expect(Buffer.compare(fetched.body, updatedBinaryFile)).toBe(0)
    expect(nonceHeader2).toBe(fetched.nonce)
  })

  it("should return 403 if object exists and is owned by another user", async () => {
    const objectId = Buffer.from(randomBytes(16))
    const objectIdString = objectId.toString("base64url")
    const binaryContent = Buffer.from("first content")

    const nonce = randomBytes(16)
    const nonceHeader = Buffer.from(nonce).toString("base64url")

    const accessKey = randomBytes(16)
    const accessKeyHeader = Buffer.from(accessKey).toString("base64url")

    const res1 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
        "x-ph-nonce": nonceHeader,
        "x-ph-access": accessKeyHeader,
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

    const nonce2 = randomBytes(16)
    const nonceHeader2 = Buffer.from(nonce2).toString("base64url")

    const accessKey2 = randomBytes(16)
    const accessKeyHeader2 = Buffer.from(accessKey2).toString("base64url")

    const res2 = await app.inject({
      method: "PUT",
      url: `/content/${objectIdString}`,
      headers: {
        authorization: `Bearer ${newToken}`,
        "content-type": "application/octet-stream",
        "x-ph-nonce": nonceHeader2,
        "x-ph-access": accessKeyHeader2,
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

    const nonce = randomBytes(16)
    const nonceHeader = Buffer.from(nonce).toString("base64url")

    const accessKey = randomBytes(16)
    const accessKeyHeader = Buffer.from(accessKey).toString("base64url")

    const res = await app.inject({
      method: "PUT",
      url: `/content/${objectId}`,
      headers: {
        authorization: `Bearer ${unsignedToken}`,
        "content-type": "application/octet-stream",
        "x-ph-nonce": nonceHeader,
        "x-ph-access": accessKeyHeader,
      },
      payload: binaryContent,
    })

    expect(res.statusCode).toBe(401)
  })

  it("should upload and retrieve avatar with same content", async () => {
    const image = Buffer.from([137, 80, 78, 71, 0, 1, 2, 3])

    const putRes = await app.inject({
      method: "PUT",
      url: "/avatar",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/png",
      },
      payload: image,
    })

    expect(putRes.statusCode).toBe(204)

    const getRes = await app.inject({
      method: "GET",
      url: `/avatar/${testUserId}`,
      headers: {
        authorization: `Bearer ${token}`,
      },
    })

    expect(getRes.statusCode).toBe(200)
    expect(Buffer.compare(getRes.rawPayload, image)).toBe(0)
    expect(getRes.headers["content-type"]).toContain("image/png")
  })

  it("should return 401 for avatar endpoints without valid token", async () => {
    const image = Buffer.from([255, 216, 255, 224, 0, 16])

    const putNoAuth = await app.inject({
      method: "PUT",
      url: "/avatar",
      headers: {
        "content-type": "image/jpeg",
      },
      payload: image,
    })
    expect(putNoAuth.statusCode).toBe(401)

    const getNoAuth = await app.inject({
      method: "GET",
      url: `/avatar/${testUserId}`,
    })
    expect(getNoAuth.statusCode).toBe(401)

    const putBadAuth = await app.inject({
      method: "PUT",
      url: "/avatar",
      headers: {
        authorization: `Bearer invalid.token.here`,
        "content-type": "image/jpeg",
      },
      payload: image,
    })
    expect(putBadAuth.statusCode).toBe(401)

    const getBadAuth = await app.inject({
      method: "GET",
      url: `/avatar/${testUserId}`,
      headers: {
        authorization: `Bearer invalid.token.here`,
      },
    })
    expect(getBadAuth.statusCode).toBe(401)
  })

  it("should return 404 when fetching non-existing avatar", async () => {
    const newToken = await new SignJWT({ sub: "no-avatar-user", ["ph-user"]: "noavatar" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime("72h")
      .setIssuer("ph-auth")
      .sign(privateKey)

    const res = await app.inject({
      method: "GET",
      url: "/avatar/no-avatar-user",
      headers: {
        authorization: `Bearer ${newToken}`,
      },
    })

    expect(res.statusCode).toBe(404)
  })

  it("should return 400 for missing or unsupported avatar content-type", async () => {
    const img = Buffer.from([0, 1, 2, 3, 4])

    const missingType = await app.inject({
      method: "PUT",
      url: "/avatar",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: img,
    })
    expect(missingType.statusCode).toBe(400)

    const unsupportedType = await app.inject({
      method: "PUT",
      url: "/avatar",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
      },
      payload: img,
    })
    expect(unsupportedType.statusCode).toBe(400)
  })
})
