import Fastify from "fastify"
import { decode } from "cbor-x"
import helmet from "@fastify/helmet"
import postgres from "@fastify/postgres"
import { JWK, exportJWK, jwtVerify } from "jose"
import { Readable } from "stream"
import { registerAuthRoutes } from "./routes/authRoutes.js"
import { registerContentRoutes } from "./routes/contentRoutes.js"
import { registerMessageRoutes } from "./routes/messageRoutes.js"

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
  messageTtlSeconds?: number
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

  // Helper functions
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

  function shardObjectKey(objectId: string): string {
    const level1 = objectId.slice(0, 2)
    const level2 = objectId.slice(2, 4)
    const remaining = objectId.slice(4)
    return `${level1}/${level2}/${remaining}`
  }

  function createDecoy(): string {
    const decoy = crypto.getRandomValues(new Uint8Array(320))
    const encoded = Buffer.from(decoy).toString("base64")
    return encoded.replace(/=+$/, "")
  }

  async function queryUserExists(username: string): Promise<boolean> {
    const res = await fastify.pg.query<{ exists: boolean }>("SELECT EXISTS(SELECT 1 FROM users WHERE username=$1)", [
      username,
    ])
    return res.rows.at(0)?.exists ?? false
  }

  async function getRegistrationRecord(username: string): Promise<string | undefined> {
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

  async function getPublicUserInfo(userIds: string[]): Promise<{ username: string; key: Buffer; userid: string }[]> {
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

  async function getUserByUsername(username: string): Promise<{ username: string; key: Buffer; userid: string } | undefined> {
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

  async function saveUser(user: FinishRegistrationBody): Promise<SaveUserResult> {
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

  async function saveLoginState(username: string, loginState: string): Promise<void> {
    await fastify.pg.query(
      `INSERT INTO opaque_sessions (username, state, expires_at) 
        VALUES ($1, $2, NOW() + INTERVAL '5 minutes')
        ON CONFLICT (username) DO UPDATE SET state = $2, expires_at = NOW() + INTERVAL '5 minutes'`,
      [username, loginState],
    )
  }

  async function getLoginState(username: string): Promise<string | undefined> {
    const res = await fastify.pg.query<{ state: string }>(
      `SELECT state FROM opaque_sessions WHERE username = $1 AND expires_at > NOW()`,
      [username],
    )
    if (res.rows.length < 1) {
      return undefined
    }
    return res.rows.at(0)?.state
  }

  // Register route handlers with prefixes using Fastify plugin pattern
  await fastify.register(
    (fastify, opts, done) => {
      registerAuthRoutes(fastify, config, {
        authenticate,
        queryUserExists,
        getRegistrationRecord,
        createDecoy,
        saveLoginState,
        getLoginState,
        getUserInfo,
        getPublicUserInfo,
        getUserByUsername,
        saveUser,
      }).then(() => done()).catch(done)
    },
    { prefix: "/auth" },
  )

  // Register content routes with prefix using Fastify plugin pattern
  await fastify.register(
    (fastify, opts, done) => {
      registerContentRoutes(fastify, config, {
        authenticate,
        streamToBuffer,
        shardObjectKey,
      }).then(() => done()).catch(done)
    },
    { prefix: "/content" },
  )

  // Register message routes with prefix using Fastify plugin pattern
  await fastify.register(
    (fastify, opts, done) => {
      registerMessageRoutes(fastify, config, {
        authenticate,
      }).then(() => done()).catch(done)
    },
    { prefix: "/messages" },
  )

  // JWKS endpoint (not prefixed - stays at root)
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

  return fastify
}
