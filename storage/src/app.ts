import Fastify from "fastify"
import { decode, encode } from "cbor-x"
import helmet from "@fastify/helmet"
import { jwtVerify } from "jose"
import { HeadObjectCommand, PutObjectCommand, S3Client, GetObjectCommand } from "@aws-sdk/client-s3"
import { Readable } from "stream"

export async function build(config: {
  minioEndpoint: string
  minioAccessKeyId: string
  minioSecretAccessKey: string
  bucketName: string
  publicKey: CryptoKey
}) {
  const fastify = Fastify()

  fastify.register(helmet, { global: true })

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

  const putContentSchema = {
    schema: {
      params: {
        type: "object",
        properties: {
          objectId: { type: "string" },
        },
        required: ["objectId"],
      },
      headers: {
        type: "object",
        properties: {
          "x-ph-nonce": { type: "string" },
          "x-ph-access": { type: "string" },
        },
        required: ["x-ph-nonce", "x-ph-access"],
      },
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

  fastify.put<{ Params: { objectId: string }; Headers: { "x-ph-nonce": string; "x-ph-access": string } }>(
    "/content/:objectId",
    putContentSchema,
    async (req, reply) => {
      const user = await authenticate(req.headers.authorization)
      if (user.status === "error") return reply.code(401).type("application/cbor").send()

      if (req.headers["content-type"] !== "application/octet-stream") {
        return reply.code(400).send(encode({ error: "Expected application/octet-stream" }))
      }

      const nonce = req.headers["x-ph-nonce"]
      const accessKey = req.headers["x-ph-access"]

      const objectId = req.params.objectId
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

      const buffer = await streamToBuffer(req.raw)

      await s3.send(
        new PutObjectCommand({
          Bucket: config.bucketName,
          Key: key,
          Body: buffer,
          ContentType: "application/octet-stream",
          Metadata: { nonce: nonce, token: accessKey, userId: user.userId },
        }),
      )

      return reply.code(204).send()
    },
  )

  const batchContentSchema = {
    schema: {
      body: {
        type: "array",
        items: { type: "array", items: { type: "object" }, minItems: 2 },
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

  fastify.post<{ Body: [Uint8Array, Uint8Array][] }>("/content/batch", batchContentSchema, async (req, reply) => {
    const user = await authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const input = req.body

    const objectIdStrings = input.map(
      (id) => [Buffer.from(id[0]).toString("base64url"), Buffer.from(id[1]).toString("base64url")] as const,
    )

    try {
      const fetches = objectIdStrings.map(async ([objectId, token]) => {
        const key = shardObjectKey(objectId)
        try {
          const obj = await s3.send(
            new GetObjectCommand({
              Bucket: config.bucketName,
              Key: key,
            }),
          )

          if (obj.Metadata?.["token"] !== token) {
            throw new FetchError(objectId)
          }

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

function isErrorWithName(err: unknown): err is { name: string } {
  return typeof err === "object" && err !== null && "name" in err && typeof err.name === "string"
}

function shardObjectKey(objectId: string): string {
  const level1 = objectId.slice(0, 2)
  const level2 = objectId.slice(2, 4)
  const remaining = objectId.slice(4)
  return `${level1}/${level2}/${remaining}`
}
