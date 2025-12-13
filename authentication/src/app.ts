import Fastify from "fastify"
import { decode, encode } from "cbor-x"
import helmet from "@fastify/helmet"
import postgres from "@fastify/postgres"
import * as opaque from "@serenity-kit/opaque"
import { JWK, SignJWT, exportJWK } from "jose"

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
