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

  async function upload(objectId: Buffer, binaryContent: Buffer, nonce: Buffer, token: string) {
    const objectIdString = objectId.toString("base64url")
    // Build single-item batch payload in the new binary format
    // [magic: 4 bytes][version: 2 bytes]
    // [nonce_len: u16][nonce]
    // [id_len: u16][id]
    // [blob_len: u64][blob]
    const magic = 0xdaab0000
    const version = 1

    const idBytes = Buffer.from(objectIdString, "base64url")
    const totalSize = 4 + 2 + 2 + nonce.length + 2 + idBytes.length + 8 + binaryContent.length
    const buf = Buffer.alloc(totalSize)
    let offset = 0

    buf.writeUInt32BE(magic, offset)
    offset += 4
    buf.writeUInt16BE(version, offset)
    offset += 2

    buf.writeUInt16BE(nonce.length, offset)
    offset += 2
    nonce.copy(buf, offset)
    offset += nonce.length

    buf.writeUInt16BE(idBytes.length, offset)
    offset += 2
    idBytes.copy(buf, offset)
    offset += idBytes.length

    buf.writeBigUInt64BE(BigInt(binaryContent.length), offset)
    offset += 8
    binaryContent.copy(buf, offset)

    const putResponse = await app.inject({
      method: "PUT",
      url: "/content/batch",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      payload: buf,
    })

    const nonceHeader = Buffer.from(nonce).toString("base64url")
    return { putResponse, objectId, objectIdString, binaryContent, nonceHeader }
  }

  async function uploadRandomFile() {
    const objectId = randomBytes(16)
    

    const binaryContent = Buffer.from("hello world")

    const nonce = randomBytes(16)
    return upload(objectId, binaryContent, nonce, token)
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
    const { putResponse, objectId, objectIdString, nonceHeader, binaryContent } = await uploadRandomFile()

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
    const fetched = decoded[objectIdString]

    expect(Buffer.compare(fetched.body, binaryContent)).toBe(0)
    expect(nonceHeader).toBe(fetched.nonce)
  })

  it("should upload multiple files and retrieve them via batch", async () => {
    const {
      objectId: objId1,
      objectIdString: idStr1,
      binaryContent: content1,
      nonceHeader: nonceHeader1,
    } = await uploadRandomFile()
    const {
      objectId: objId2,
      objectIdString: idStr2,
      binaryContent: content2,
      nonceHeader: nonceHeader2,
    } = await uploadRandomFile()

    const batchBody = encode([
      objId1,
      objId2,
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
    const { objectId } = await uploadRandomFile()

    const nonExistentObjectId = Buffer.from(randomBytes(16))
    const nonExistentObjectIdString = nonExistentObjectId.toString("base64url")

    const batchBody = encode([
      objectId,
      nonExistentObjectId,
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
    const binaryContent = Buffer.from("hello world")

    const req = {
      method: "PUT",
      url: `/content/batch`,
      headers: {
        "content-type": "application/octet-stream",
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
    const binaryContent = Buffer.from("hello world")


    const res = await app.inject({
      method: "PUT",
      url: `/content/batch`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
      },
      payload: binaryContent,
    })

    expect(res.statusCode).toBe(400)
    const decoded = decode(res.rawPayload)
    expect(decoded).toEqual({ error: "Expected application/octet-stream" })
  })


  it("should allow update if object exists and is owned by same user", async () => {
    const objectId = Buffer.from(randomBytes(16))
    
    const objectIdString = objectId.toString("base64url")
    const binaryContent = Buffer.from("first content")
    const nonce = randomBytes(16)

    const res1 = await upload(objectId, binaryContent, nonce, token)
    expect(res1.putResponse.statusCode).toBe(204)

    const nonce2 = randomBytes(16)

    const updatedBinaryFile = Buffer.from("overwrite")

    const res2 = await upload(objectId, updatedBinaryFile, nonce2, token)

    expect(res2.putResponse.statusCode).toBe(204)

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
    const fetched = decoded2[objectIdString]

    expect(Buffer.compare(fetched.body, updatedBinaryFile)).toBe(0)
    expect(nonce2.toString("base64url")).toBe(fetched.nonce)
  })

  it("should return 403 if object exists and is owned by another user", async () => {
    const objectId = Buffer.from(randomBytes(16))
    const binaryContent = Buffer.from("first content")

    const nonce = randomBytes(16)

    const res1 = await upload(objectId, binaryContent, nonce, token)
    expect(res1.putResponse.statusCode).toBe(204)

    const newToken = await new SignJWT({ sub: "456", ["ph-user"]: "bobby" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000))
      .setExpirationTime("72h")
      .setIssuer("ph-auth")
      .sign(privateKey)

    const nonce2 = randomBytes(16)


    const res2 = await upload(objectId, Buffer.from("malicious overwrite"), nonce2, newToken)

    expect(res2.putResponse.statusCode).toBe(403)
    const decoded = decode(res2.putResponse.rawPayload)
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

    const objectId = Buffer.from(randomBytes(16))
    const binaryContent = Buffer.from("hello world")

    const nonce = randomBytes(16)

    const res = await upload(objectId, binaryContent, nonce, unsignedToken)

    expect(res.putResponse.statusCode).toBe(401)
  })

  it("should upload and retrieve avatar with same content", async () => {
    const image = Buffer.from([137, 80, 78, 71, 0, 1, 2, 3])

    const putRes = await app.inject({
      method: "PUT",
      url: "/content/avatar",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "image/png",
      },
      payload: image,
    })

    expect(putRes.statusCode).toBe(204)

    const getRes = await app.inject({
      method: "GET",
      url: `/content/avatar/${testUserId}`,
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
      url: "/content/avatar",
      headers: {
        "content-type": "image/jpeg",
      },
      payload: image,
    })
    expect(putNoAuth.statusCode).toBe(401)

    const getNoAuth = await app.inject({
      method: "GET",
      url: `/content/avatar/${testUserId}`,
    })
    expect(getNoAuth.statusCode).toBe(401)

    const putBadAuth = await app.inject({
      method: "PUT",
      url: "/content/avatar",
      headers: {
        authorization: `Bearer invalid.token.here`,
        "content-type": "image/jpeg",
      },
      payload: image,
    })
    expect(putBadAuth.statusCode).toBe(401)

    const getBadAuth = await app.inject({
      method: "GET",
      url: `/content/avatar/${testUserId}`,
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
      url: "/content/avatar/no-avatar-user",
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
      url: "/content/avatar",
      headers: {
        authorization: `Bearer ${token}`,
      },
      payload: img,
    })
    expect(missingType.statusCode).toBe(400)

    const unsupportedType = await app.inject({
      method: "PUT",
      url: "/content/avatar",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "text/plain",
      },
      payload: img,
    })
    expect(unsupportedType.statusCode).toBe(400)
  })
})
