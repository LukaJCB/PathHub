import Fastify from "fastify"
import { decode, encode } from "cbor-x"
import helmet from "@fastify/helmet"
import postgres from "@fastify/postgres"
import * as opaque from "@serenity-kit/opaque"
import { JWK, SignJWT, exportJWK, jwtVerify } from "jose"
import { HeadObjectCommand, PutObjectCommand, S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { Readable } from "stream"

interface StartRegistrationBody {
  username: string
  registrationRequest: string
}

interface FinishRegistrationBody {
  username: string
  registrationRecord: string
  encryptedMasterKey: Uint8Array
  masterKeyNonce: Uint8Array
  encryptedRecoveryKey: Uint8Array
  recoveryKeyNonce: Uint8Array
  passwordEncryptedMasterKey: Uint8Array
  passwordMasterKeyNonce: Uint8Array
  salt: Uint8Array
  signingPublicKey: Uint8Array
}

interface StartLoginBody {
  username: string
  startLoginRequest: string
}

interface FinishLoginBody {
  username: string
  finishLoginRequest: string
}

export async function build(config: {
  opaqueSecret: string
  pgConnection: string
  signingKey: CryptoKey
  publicKey: CryptoKey
  publicKeyId: string
  minioEndpoint: string
  minioAccessKeyId: string
  minioSecretAccessKey: string
  bucketName: string
  bucketNamePublic: string
}) {
  const fastify = Fastify()

  fastify.register(helmet, { global: true })

  fastify.register(postgres, {
    connectionString: config.pgConnection,
  })

  fastify.addContentTypeParser("application/cbor", { parseAs: "buffer" }, (_req, body, done) => {
    try {
      done(null, decode(body as Buffer))
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  //this is needed for piping the request stream directly, otherwise server won't accept application/octet-stream
  fastify.addContentTypeParser("*", (_req, _payload, done) => {
    done(null, undefined)
  })

  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: config.minioEndpoint,
    credentials: {
      accessKeyId: config.minioAccessKeyId,
      secretAccessKey: config.minioSecretAccessKey,
    },
    forcePathStyle: true,
  })

  const startRegistrationSchema = {
    schema: {
      body: {
        type: "object",
        required: ["username", "registrationRequest"],
        properties: {
          username: { type: "string" },
          registrationRequest: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            response: { type: "string" },
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        409: {
          type: "object",
        },
      },
    },
  }

  fastify.post<{ Body: StartRegistrationBody }>("/startRegistration", startRegistrationSchema, async (req, reply) => {
    const username: string = req.body.username
    const registrationRequest = req.body.registrationRequest

    const userExists = await queryUserExists(fastify, username)

    if (userExists) return reply.code(409).type("application/cbor").send()

    try {
      const { registrationResponse } = opaque.server.createRegistrationResponse({
        serverSetup: config.opaqueSecret,
        userIdentifier: username,
        registrationRequest,
      })
      return reply
        .code(200)
        .type("application/cbor")
        .send(encode({ response: registrationResponse }))
    } catch (err) {
      console.log(err)
      return reply
        .code(400)
        .type("application/cbor")
        .send(encode({ error: "Invalid input" }))
    }
  })

  const finishRegistrationSchema = {
    schema: {
      body: {
        type: "object",
        required: [
          "username",
          "registrationRecord",
          "encryptedMasterKey",
          "masterKeyNonce",
          "encryptedRecoveryKey",
          "recoveryKeyNonce",
          "passwordEncryptedMasterKey",
          "passwordMasterKeyNonce",
          "salt",
          "signingPublicKey",
        ],
        properties: {
          username: { type: "string" },
          registrationRecord: { type: "string" },
          encryptedMasterKey: { type: "object" },
          masterKeyNonce: { type: "object" },
          encryptedRecoveryKey: { type: "object" },
          recoveryKeyNonce: { type: "object" },
          passwordEncryptedMasterKey: { type: "object" },
          passwordMasterKeyNonce: { type: "object" },
          salt: { type: "object" },
          signingPublicKey: { type: "object" },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            userId: { type: "string" },
          },
        },
        409: {
          type: "object",
        },
      },
    },
  }

  fastify.post<{ Body: FinishRegistrationBody }>(
    "/finishRegistration",
    finishRegistrationSchema,
    async (req, reply) => {
      const result = await saveUser(fastify, req.body)

      if (result.status === "ok") {
        return reply
          .code(201)
          .type("application/cbor")
          .send(encode({ userId: result.userId }))
      } else
        return reply
          .code(409)
          .type("application/cbor")
          .send(encode({ error: "Username already exists" }))
    },
  )

  const startLoginSchema = {
    schema: {
      body: {
        type: "object",
        required: ["username", "startLoginRequest"],
        properties: {
          username: { type: "string" },
          startLoginRequest: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            response: { type: "string" },
          },
        },
      },
    },
  }

  fastify.post<{ Body: StartLoginBody }>("/startLogin", startLoginSchema, async (req, reply) => {
    const username: string = req.body.username
    const startLoginRequest = req.body.startLoginRequest

    const result = await getRegistrationRecord(fastify, username)

    if (result === undefined) {
      const decoy = createDecoy()
      return reply
        .code(200)
        .type("application/cbor")
        .send(encode({ response: decoy }))
    } else {
      try {
        const { loginResponse, serverLoginState } = opaque.server.startLogin({
          serverSetup: config.opaqueSecret,
          userIdentifier: username,
          registrationRecord: result,
          startLoginRequest,
        })

        await saveLoginState(fastify, username, serverLoginState)

        return reply
          .code(200)
          .type("application/cbor")
          .send(encode({ response: loginResponse }))
      } catch (err) {
        const decoy = createDecoy()

        return reply
          .code(200)
          .type("application/cbor")
          .send(encode({ response: decoy }))
      }
    }
  })

  const finishLoginSchema = {
    schema: {
      body: {
        type: "object",
        required: ["username", "finishLoginRequest"],
        properties: {
          username: { type: "string" },
          finishLoginRequest: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            token: { type: "string" },
            manifestId: { type: "string" },
            encryptedMasterKey: { type: "object" },
            nonce: { type: "object" },
            salt: { type: "object" },
          },
        },
        401: {
          type: "object",
        },
      },
    },
  }

  fastify.post<{ Body: FinishLoginBody }>("/finishLogin", finishLoginSchema, async (req, reply) => {
    const username: string = req.body.username
    const finishLoginRequest = req.body.finishLoginRequest

    const result = await getLoginState(fastify, username)

    if (result === undefined) {
      return reply.code(401).type("application/cbor").send()
    } else {
      try {
        opaque.server.finishLogin({
          finishLoginRequest,
          serverLoginState: result,
        })

        const userInfo = await getUserInfo(fastify, username)

        const token = await new SignJWT({ sub: userInfo?.user, ["ph-user"]: username })
          .setProtectedHeader({ alg: "EdDSA" })
          .setIssuedAt()
          .setNotBefore(Math.floor(Date.now() / 1000))
          .setExpirationTime("72h")
          .setIssuer("ph-auth")
          .sign(config.signingKey)

        return reply
          .code(200)
          .type("application/cbor")
          .send(
            encode({
              token,
              manifest: userInfo?.manifest?.toString("base64url"),
              encryptedMasterKey: userInfo?.key,
              nonce: userInfo?.nonce,
              salt: userInfo?.salt,
            }),
          )
      } catch (err) {
        return reply.code(401).type("application/cbor").send()
      }
    }
  })

  const getPublicUserInfoSchema = {
    schema: {
      body: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
      },
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            properties: {
              username: { type: "string" },
              key: { type: "object" },
              userid: { type: "string" }
            },
          },
          minItems: 1
        },
        401: {
          type: "object",
        },
        404: {
          type: "object",
        },
      },
    },
  }

  fastify.post<{ Body: string[] }>("/userInfo", getPublicUserInfoSchema, async (req, reply) => {
    const user = await authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()


    const result = await getPublicUserInfo(fastify, req.body)

    if (result.length < 1) {
      return reply.code(404).type("application/cbor").send()
    } else {

        return reply
          .code(200)
          .type("application/cbor")
          .send(
            encode(result),
          )
      
    }
  })

  const lookupUserSchema = {
    schema: {
      body: {
        type: "object",
        required: ["username"],
        properties: {
          username: { type: "string" },
        },
      },
      response: {
        200: {
          type: "object",
          properties: {
            username: { type: "string" },
            key: { type: "object" },
            userid: { type: "string" },
          },
        },
        401: {
          type: "object",
        },
        404: {
          type: "object",
        },
      },
    },
  }

  fastify.post<{ Body: { username: string } }>("/lookupUser", lookupUserSchema, async (req, reply) => {
    const user = await authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const result = await getUserByUsername(fastify, req.body.username)

    if (!result) {
      return reply.code(404).type("application/cbor").send()
    }

    return reply
      .code(200)
      .type("application/cbor")
      .send(encode(result))
  })

  const jwkSchema = {
    type: "object",
    required: ["kty", "crv", "x", "alg", "use", "kid"],
    properties: {
      kty: { type: "string", enum: ["OKP"] },
      crv: { type: "string", enum: ["Ed25519"] },
      x: { type: "string" },
      alg: { type: "string", enum: ["EdDSA"] },
      use: { type: "string", enum: ["sig"] },
      kid: { type: "string" },
    },
  }

  const jwksSchema = {
    schema: {
      response: {
        200: {
          type: "object",
          properties: {
            keys: {
              type: "array",
              items: jwkSchema,
            },
          },
        },
      },
    },
  }
  interface JWKWithMeta extends JWK {
    alg: "EdDSA"
    use: "sig"
    kid: string
  }

  fastify.get<{
    Reply: { keys: JWKWithMeta[] }
  }>("/.well-known/jwks.json", jwksSchema, async (_req, reply) => {
    const jwk = await exportJWK(config.publicKey)
    const withMeta: JWKWithMeta = {
      ...jwk,
      alg: "EdDSA",
      use: "sig",
      kid: config.publicKeyId,
    }
    reply.send({ keys: [withMeta] })
  })


  type AuthenticateResult = { status: "ok"; userId: string; username: string } | { status: "error" }


async function authenticate(auth: string | undefined): Promise<AuthenticateResult> {
    if (!auth?.startsWith("Bearer ")) return { status: "error" }

    try {
      const { payload } = await jwtVerify(auth.slice(7), config.publicKey)
      if (payload.sub === undefined || payload["ph-user"] === undefined || typeof payload["ph-user"] !== "string")
        return { status: "error" }

      return { status: "ok", userId: payload.sub, username: payload["ph-user"] }
    } catch (e) {
      console.log(e)
      return { status: "error" }
    }
  }

  // Storage endpoints
  const batchContentUploadSchema = {
    schema: {
      response: {
        204: {
          type: "object",
        },
        401: {
          type: "object",
        },
        403: {
          type: "object",
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        500: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }


  fastify.put(
    "/content/batch",
    batchContentUploadSchema,
    async (req, reply) => {
      const user = await authenticate(req.headers.authorization)
      if (user.status === "error") return reply.code(401).type("application/cbor").send()

      if (req.headers["content-type"] !== "application/octet-stream") {
        return reply.code(400).send(encode({ error: "Expected application/octet-stream" }))
      }

      const buffer = await streamToBuffer(req.raw)
      let offset = 0

      // Parse magic and version
      if (buffer.length < 6) {
        return reply.code(400).send(encode({ error: "Invalid batch format: too short" }))
      }

      const magic = buffer.readUInt32BE(offset)
      offset += 4
      const version = buffer.readUInt16BE(offset)
      offset += 2

      if (magic !== 0xdaab0000) {
        return reply.code(400).send(encode({ error: "Invalid magic bytes" }))
      }

      if (version !== 1) {
        return reply.code(400).send(encode({ error: `Unsupported version: ${version}` }))
      }

      try {

        while (offset < buffer.length) {

          if (offset + 2 > buffer.length) {
            return reply.code(400).send(encode({ error: "Truncated nonce length" }))
          }
          const nonceLen = buffer.readUInt16BE(offset)
          offset += 2

          if (offset + nonceLen > buffer.length) {
            return reply.code(400).send(encode({ error: "Truncated nonce" }))
          }
          const nonce = buffer.subarray(offset, offset + nonceLen).toString("base64url")
          offset += nonceLen


          if (offset + 2 > buffer.length) {
            return reply.code(400).send(encode({ error: "Truncated ID length" }))
          }
          const idLen = buffer.readUInt16BE(offset)
          offset += 2

          if (offset + idLen > buffer.length) {
            return reply.code(400).send(encode({ error: "Truncated ID" }))
          }
          const objectId = buffer.subarray(offset, offset + idLen).toString("base64url")
          offset += idLen

          if (offset + 8 > buffer.length) {
            return reply.code(400).send(encode({ error: "Truncated blob length" }))
          }
          const blobLen = Number(buffer.readBigUInt64BE(offset))
          offset += 8

          if (offset + blobLen > buffer.length) {
            return reply.code(400).send(encode({ error: "Truncated blob" }))
          }
          const blob = buffer.subarray(offset, offset + blobLen)
          offset += blobLen

          // Check ownership and upload
          const key = shardObjectKey(objectId)

          try {
            const head = await s3.send(
              new HeadObjectCommand({
                Bucket: config.bucketName,
                Key: key,
              }),
            )

            const owner = head.Metadata?.["userid"]
            if (owner && owner !== user.userId) {
              return reply.code(403).send(encode({ error: "This object is restricted" }))
            }
          } catch (err) {
            if (isErrorWithName(err) && err.name !== "NotFound") {
              throw err
            }
          }


          await s3.send(
            new PutObjectCommand({
              Bucket: config.bucketName,
              Key: key,
              Body: blob,
              ContentType: "application/octet-stream",
              Metadata: { nonce: nonce, userId: user.userId },
            }),
          )
        }

        return reply.code(204).send()
      } catch (err) {
        console.error(err)
        return reply.code(500).send(encode({ error: "Internal server error" }))
      }
    },
  )

  const putAvatarSchema = {
    schema: {
      response: {
        204: {
          type: "object",
        },
        401: {
          type: "object",
        },
        403: {
          type: "object",
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }

  fastify.put(
    "/avatar",
    putAvatarSchema,
    async (req, reply) => {
      const user = await authenticate(req.headers.authorization)
      if (user.status === "error") return reply.code(401).type("application/cbor").send()

      const contentType = req.headers["content-type"]

      if (contentType === undefined || 
        (contentType !==  "image/png" &&
        contentType !== "image/jpeg" &&
        contentType !== "image/svg+xml")) {
          return reply.code(400).send(encode({ error: "Expected image content type" }))
        }

      const key = shardObjectKey(user.userId)

      try {
        const head = await s3.send(
          new HeadObjectCommand({
            Bucket: config.bucketNamePublic,
            Key: key,
          }),
        )

        const owner = head.Metadata?.["userid"]
        if (owner && owner !== user.userId) {
          return reply.code(403).send(encode({ error: "This object is restricted" }))
        }
      } catch (err) {
        if (isErrorWithName(err) && err.name !== "NotFound") {
          throw err
        }
      }

      const buffer = await streamToBuffer(req.raw)

      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucketNamePublic,
          Key: key,
          Body: buffer,
          ContentType: contentType,
          Metadata: { userId: user.userId },
        }),
      )

      return reply.code(204).send()
    },
  )

  const getAvatarSchema = {
    schema: {
      params: {
        type: "object",
        properties: {
          userId: { type: "string" },
        },
        required: ["userId"],
      },
      response: {
        200: {
          type: "object",
        },
        401: {
          type: "object",
        },
        404: {
          type: "object",
        },
      },
    },
  }

  fastify.get<{ Params: { userId: string }}>(
    "/avatar/:userId",
    getAvatarSchema,
    async (req, reply) => {
      const user = await authenticate(req.headers.authorization)
      if (user.status === "error") return reply.code(401).type("application/cbor").send()

      const userId = req.params.userId
      const key = shardObjectKey(userId)

      try {
        const obj = await s3.send(
            new GetObjectCommand({
              Bucket: config.bucketNamePublic,
              Key: key,
            }),
          )

        const avatar = await streamToBuffer(obj.Body as Readable)
        const mimeType = obj.ContentType ?? "application/octet-stream"
        return reply.code(200).type(mimeType).send(avatar)
      } catch (err) {
        if (isErrorWithName(err) && err.name === "NoSuchKey") {
          return reply.code(404).type("application/cbor").send()
        }
      }

      
    },
  )

  const batchContentSchema = {
    schema: {
      body: {
        type: "array",
        items: { type: "object" },
        minItems: 1,
      },
      response: {
        200: {
          type: "object",
          additionalProperties: {
            instanceof: "Buffer",
          },
        },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        401: {
          type: "object",
          properties: {},
        },
      },
    },
  }
  class FetchError extends Error {
    constructor(objectId: string) {
      super(objectId)
      this.name = "FetchError"
    }
  }

  fastify.post<{ Body: Uint8Array[] }>("/content/batch", batchContentSchema, async (req, reply) => {
    const user = await authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const input = req.body

    const objectIdStrings = input.map(
      (id) => Buffer.from(id).toString("base64url"),
    )

    try {
      const fetches = objectIdStrings.map(async (objectId) => {
        const key = shardObjectKey(objectId)
        try {
          const obj = await s3.send(
            new GetObjectCommand({
              Bucket: config.bucketName,
              Key: key,
            }),
          )

          const body = await streamToBuffer(obj.Body as Readable)
          const nonce = obj.Metadata?.["nonce"]!
          return { objectId, nonce, body }
        } catch (err) {
          if (isErrorWithName(err) && err.name === "NoSuchKey") {
            throw new FetchError(objectId)
          }
          throw err
        }
      })

      const results = await Promise.all(fetches)

      const responseMap: Record<string, { body: Buffer; nonce: string }> = {}
      for (const { objectId, body, nonce } of results) {
        responseMap[objectId] = { body, nonce }
      }

      return reply.code(200).type("application/cbor").send(encode(responseMap))
    } catch (err) {
      if (err instanceof FetchError) {
        const missingId = err.message
        return reply
          .code(404)
          .type("application/cbor")
          .send(encode({ error: `Missing objectId: ${missingId}` }))
      }

      throw err
    }
  })

  async function streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk)
      } else if (typeof chunk === "string") {
        chunks.push(Buffer.from(chunk))
      } else if (chunk instanceof Uint8Array) {
        chunks.push(Buffer.from(chunk))
      } else {
        throw new Error("Unexpected chunk type in stream")
      }
    }
    return Buffer.concat(chunks)
  }


  return fastify
}

function createDecoy(): string {
  const decoy = crypto.getRandomValues(new Uint8Array(320))

  const encoded = Buffer.from(decoy).toString("base64")

  return encoded.replace(/=+$/, "")
}

async function queryUserExists(fastify: Fastify.FastifyInstance, username: string): Promise<boolean> {
  const res = await fastify.pg.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM users WHERE username=$1)", [
    username,
  ])

  return res.rows.at(0)?.exists ?? false
}

async function getRegistrationRecord(fastify: Fastify.FastifyInstance, username: string): Promise<string | undefined> {
  const res = await fastify.pg.query<{ record: string }>(
    "SELECT registration_record as record FROM users WHERE username=$1",
    [username],
  )
  if (res.rows.length < 1) {
    return undefined
  }

  return res.rows.at(0)?.record
}

async function getUserInfo(
  fastify: Fastify.FastifyInstance,
  username: string,
): Promise<{ user: string; manifest: Buffer; key: Buffer; nonce: Buffer; salt: Buffer } | undefined> {
  const res = await fastify.pg.query<{ user: string; manifest: Buffer; key: Buffer; nonce: Buffer; salt: Buffer }>(
    `SELECT 
      user_id as user, 
      manifest_id as manifest, 
      password_encrypted_master_key as key, 
      password_master_key_nonce as nonce, 
      salt 
    FROM users 
    WHERE username=$1`,
    [username],
  )
  if (res.rows.length < 1) {
    return undefined
  }

  return res.rows.at(0)
}


async function getPublicUserInfo(
  fastify: Fastify.FastifyInstance,
  userIds: string[],
): Promise<{ username: string; key: Buffer; userid: string }[]> {
  const res = await fastify.pg.query<{ username: string; key: Buffer; userid: string }>(
    `SELECT  
      username,
      signing_public_key as key,
      user_id as userid
    FROM users 
    WHERE user_id = ANY($1::UUID[])`,
    [userIds],
  )
  if (res.rows.length < 1) {
    return []
  }

  return [...res.rows.values()]
}

async function getUserByUsername(
  fastify: Fastify.FastifyInstance,
  username: string,
): Promise<{ username: string; key: Buffer; userid: string } | undefined> {
  const res = await fastify.pg.query<{ username: string; key: Buffer; userid: string }>(
    `SELECT  
      username,
      signing_public_key as key,
      user_id as userid
    FROM users 
    WHERE username = $1`,
    [username],
  )
  if (res.rows.length < 1) {
    return undefined
  }

  return res.rows.at(0)
}

type SaveUserResult = { status: "ok"; userId: string } | { status: "conflict"; reason: "username_exists" }

async function saveUser(fastify: Fastify.FastifyInstance, user: FinishRegistrationBody): Promise<SaveUserResult> {
  const userId = crypto.randomUUID()
  const manifestId = crypto.getRandomValues(new Uint8Array(16))

  try {
    await fastify.pg.query(
      `INSERT INTO users (
        user_id,
        username,
        registration_record,
        encrypted_master_key,
        master_key_nonce,
        encrypted_recovery_key,
        recovery_key_nonce,
        password_encrypted_master_key,
        password_master_key_nonce,
        salt,
        signing_public_key,
        manifest_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        userId,
        user.username,
        user.registrationRecord,
        Buffer.from(user.encryptedMasterKey),
        Buffer.from(user.masterKeyNonce),
        Buffer.from(user.encryptedRecoveryKey),
        Buffer.from(user.recoveryKeyNonce),
        Buffer.from(user.passwordEncryptedMasterKey),
        Buffer.from(user.passwordMasterKeyNonce),
        Buffer.from(user.salt),
        Buffer.from(user.signingPublicKey),
        manifestId,
      ],
    )
    return { status: "ok", userId }
  } catch (err) {
    console.log(err)
    if (err && typeof err === "object" && "code" in err) {
      if (err.code === "23505") {
        return { status: "conflict", reason: "username_exists" }
      }
    }
    throw err
  }
}

async function saveLoginState(fastify: Fastify.FastifyInstance, username: string, loginState: string): Promise<void> {
  await fastify.pg.query(
    `INSERT INTO opaque_sessions (username, state, expires_at) 
      VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
      ON CONFLICT (username) DO UPDATE SET state = $2, expires_at = NOW() + INTERVAL '5 minutes'`,
    [username, loginState],
  )
}

async function getLoginState(fastify: Fastify.FastifyInstance, username: string): Promise<string | undefined> {
  const res = await fastify.pg.query<{ state: string }>(
    `SELECT state FROM opaque_sessions WHERE username = $1 AND expires_at > NOW()`,
    [username],
  )
  if (res.rows.length < 1) {
    return undefined
  }

  return res.rows.at(0)?.state
}

function isErrorWithName(err: unknown): err is { name: string } {
  return typeof err === "object" && err !== null && "name" in err && typeof err.name === "string"
}

function shardObjectKey(objectId: string): string {
  const level1 = objectId.slice(0, 2)
  const level2 = objectId.slice(2, 4)
  const remaining = objectId.slice(4)
  return `${level1}/${level2}/${remaining}`
}
