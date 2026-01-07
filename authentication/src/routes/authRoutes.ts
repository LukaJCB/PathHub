import Fastify from "fastify"
import * as opaque from "@serenity-kit/opaque"
import { SignJWT } from "jose"
import { encode } from "cbor-x"

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

export async function registerAuthRoutes(
  fastify: Fastify.FastifyInstance,
  config: {
    opaqueSecret: string
    signingKey: CryptoKey
    publicKey: CryptoKey
    publicKeyId: string
  },
  helpers: {
    authenticate: (auth: string | undefined) => Promise<{ status: "ok"; userId: string; username: string } | { status: "error" }>
    queryUserExists: (username: string) => Promise<boolean>
    getRegistrationRecord: (username: string) => Promise<string | undefined>
    createDecoy: () => string
    saveLoginState: (username: string, loginState: string) => Promise<void>
    getLoginState: (username: string) => Promise<string | undefined>
    getUserInfo: (
      username: string,
    ) => Promise<{ user: string; manifest: Buffer; key: Buffer; nonce: Buffer; salt: Buffer } | undefined>
    getPublicUserInfo: (userIds: string[]) => Promise<{ username: string; key: Buffer; userid: string }[]>
    getUserByUsername: (username: string) => Promise<{ username: string; key: Buffer; userid: string } | undefined>
    saveUser: (user: FinishRegistrationBody) => Promise<{ status: "ok"; userId: string } | { status: "conflict"; reason: "username_exists" }>
  },
) {
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

  fastify.post<{ Body: StartRegistrationBody }>(
    "/startRegistration",
    startRegistrationSchema,
    async (req, reply) => {
      const username: string = req.body.username
      const registrationRequest = req.body.registrationRequest

      const userExists = await helpers.queryUserExists(username)

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
    },
  )

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
      const result = await helpers.saveUser(req.body)

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

  fastify.post<{ Body: StartLoginBody }>(
    "/startLogin",
    startLoginSchema,
    async (req, reply) => {
      const username: string = req.body.username
      const startLoginRequest = req.body.startLoginRequest

      const result = await helpers.getRegistrationRecord(username)

      if (result === undefined) {
        const decoy = helpers.createDecoy()
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

          await helpers.saveLoginState(username, serverLoginState)

          return reply
            .code(200)
            .type("application/cbor")
            .send(encode({ response: loginResponse }))
        } catch (err) {
          const decoy = helpers.createDecoy()

          return reply
            .code(200)
            .type("application/cbor")
            .send(encode({ response: decoy }))
        }
      }
    },
  )

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

  fastify.post<{ Body: FinishLoginBody }>(
    "/finishLogin",
    finishLoginSchema,
    async (req, reply) => {
      const username: string = req.body.username
      const finishLoginRequest = req.body.finishLoginRequest

      const result = await helpers.getLoginState(username)

      if (result === undefined) {
        return reply.code(401).type("application/cbor").send()
      } else {
        try {
          opaque.server.finishLogin({
            finishLoginRequest,
            serverLoginState: result,
          })

          const userInfo = await helpers.getUserInfo(username)

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
    },
  )

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
              userid: { type: "string" },
            },
          },
          minItems: 1,
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

  fastify.post<{ Body: string[] }>(
    "/userInfo",
    getPublicUserInfoSchema,
    async (req, reply) => {
      const user = await helpers.authenticate(req.headers.authorization)
      if (user.status === "error") return reply.code(401).type("application/cbor").send()

      const result = await helpers.getPublicUserInfo(req.body)

      if (result.length < 1) {
        return reply.code(404).type("application/cbor").send()
      } else {
        return reply
          .code(200)
          .type("application/cbor")
          .send(encode(result))
      }
    },
  )

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

  fastify.post<{ Body: { username: string } }>(
    "/lookupUser",
    lookupUserSchema,
    async (req, reply) => {
      const user = await helpers.authenticate(req.headers.authorization)
      if (user.status === "error") return reply.code(401).type("application/cbor").send()

      const result = await helpers.getUserByUsername(req.body.username)

      if (!result) {
        return reply.code(404).type("application/cbor").send()
      }

      return reply
        .code(200)
        .type("application/cbor")
        .send(encode(result))
    },
  )

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

  interface JWKWithMeta {
    kty: string
    crv: string
    x: string
    alg: "EdDSA"
    use: "sig"
    kid: string
  }

  fastify.get<{
    Reply: { keys: JWKWithMeta[] }
  }>("/.well-known/jwks.json", jwksSchema, async (_req, reply) => {
    const { exportJWK } = await import("jose")
    const jwk = await exportJWK(config.publicKey)
    const withMeta: JWKWithMeta = {
      kty: jwk.kty || "",
      crv: jwk.crv || "",
      x: jwk.x || "",
      alg: "EdDSA",
      use: "sig",
      kid: config.publicKeyId,
    }
    reply.send({ keys: [withMeta] })
  })
}
