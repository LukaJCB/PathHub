import Fastify from "fastify"
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3"
import { Readable } from "stream"
import { encode } from "cbor-x"
import { randomBytes } from "crypto"

export async function registerContentRoutes(
  fastify: Fastify.FastifyInstance,
  config: {
    minioEndpoint: string
    minioAccessKeyId: string
    minioSecretAccessKey: string
    bucketName: string
    bucketNamePublic: string
  },
  helpers: {
    authenticate: (
      auth: string | undefined,
    ) => Promise<{ status: "ok"; userId: string; username: string } | { status: "error" }>
    streamToBuffer: (stream: Readable) => Promise<Buffer>
    shardObjectKey: (objectId: string) => string
  },
) {
  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: config.minioEndpoint,
    credentials: {
      accessKeyId: config.minioAccessKeyId,
      secretAccessKey: config.minioSecretAccessKey,
    },
    forcePathStyle: true,
  })

  function isErrorWithName(err: unknown): err is { name: string } {
    return typeof err === "object" && err !== null && "name" in err
  }

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
        412: {
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

  fastify.put("/batch", batchContentUploadSchema, async (req, reply) => {
    const user = await helpers.authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    if (req.headers["content-type"] !== "application/octet-stream") {
      return reply.code(400).send(encode({ error: "Expected application/octet-stream" }))
    }

    const buffer = await helpers.streamToBuffer(req.raw as Readable)
    let offset = 0

    // Parse magic and version
    if (buffer.length < 6) {
      return reply.code(400).send(encode({ error: "Invalid batch format: too short" }))
    }

    const magic = buffer.readUInt32BE(offset)
    offset += 4
    const protocolVersion = buffer.readUInt16BE(offset)
    offset += 2

    if (magic !== 0xdaab0000) {
      return reply.code(400).send(encode({ error: "Invalid magic bytes" }))
    }

    if (protocolVersion !== 1) {
      return reply.code(400).send(encode({ error: `Unsupported version: ${protocolVersion}` }))
    }

    try {
      const uploads: Array<{ objectId: string; storageId: string; nonce: string; version: bigint; blob: Buffer }> = []

      while (offset < buffer.length) {
        if (offset + 2 > buffer.length) return reply.code(400).send(encode({ error: "Truncated nonce length" }))
        const nonceLen = buffer.readUInt16BE(offset)
        offset += 2
        if (offset + nonceLen > buffer.length) return reply.code(400).send(encode({ error: "Truncated nonce" }))
        const nonce = buffer.subarray(offset, offset + nonceLen).toString("base64url")
        offset += nonceLen

        if (offset + 2 > buffer.length) return reply.code(400).send(encode({ error: "Truncated ID length" }))
        const idLen = buffer.readUInt16BE(offset)
        offset += 2
        if (offset + idLen > buffer.length) return reply.code(400).send(encode({ error: "Truncated ID" }))
        const objectId = buffer.subarray(offset, offset + idLen).toString("base64url")
        offset += idLen

        if (offset + 8 > buffer.length) return reply.code(400).send(encode({ error: "Truncated version" }))
        const version = buffer.readBigUInt64BE(offset)
        offset += 8

        if (offset + 8 > buffer.length) return reply.code(400).send(encode({ error: "Truncated blob length" }))
        const blobLen = Number(buffer.readBigUInt64BE(offset))
        offset += 8
        if (offset + blobLen > buffer.length) return reply.code(400).send(encode({ error: "Truncated blob" }))
        const blob = buffer.subarray(offset, offset + blobLen)
        offset += blobLen

        const storageId = randomBytes(32).toString("base64url")
        uploads.push({ objectId, storageId, nonce, version, blob })
      }

      if (uploads.length > 0) {
        for (const { storageId, nonce, blob } of uploads) {
          const key = helpers.shardObjectKey(storageId)
          await s3.send(
            new PutObjectCommand({
              Bucket: config.bucketName,
              Key: key,
              Body: blob,
              ContentType: "application/octet-stream",
              Metadata: { nonce, userId: user.userId },
            }),
          )
        }

        const client = await fastify.pg.connect()
        let isErr: { code: 403; objectId: string } | { code: 412; version: bigint; objectId: string } | null = null
        try {
          await client.query("BEGIN")
          

          for (const u of uploads) {
            if (u.objectId === "p2vO4Re-VdaqeN_H33UWP9AUHOLuKwD9E1yZjljbeIE") {
              console.log(u)
              console.log(user)
            }
            const result = await client.query(
              `INSERT INTO content_pointers (user_id, object_id, storage_id)
                VALUES ($1, $2, $3)
                ON CONFLICT (object_id) DO UPDATE
                SET storage_id = EXCLUDED.storage_id,
                    version = content_pointers.version + 1
                WHERE content_pointers.version = $4
                  AND content_pointers.user_id = EXCLUDED.user_id;`,
              [user.userId, u.objectId, u.storageId, u.version],
            )
            if (result.rowCount !== 1) {
              console.log(result.rowCount)
              const existsRes = await client.query<{ version: bigint; user_id: string }>(
                `SELECT version, user_id FROM content_pointers WHERE object_id = $1`,
                [u.objectId],
              )
              

              await client.query("ROLLBACK")
              const resultRow = existsRes.rows[0]!
              console.log(resultRow)
              if (resultRow.user_id !== user.userId) {
                isErr = { code: 403, objectId: u.objectId }
              } else if (resultRow.version !== u.version) {
                isErr = { code: 412, objectId: u.objectId, version: BigInt(resultRow.version) }
              }
              break
            }
          }
          await client.query("COMMIT")
        } catch (err) {
          await client.query("ROLLBACK")
          throw err
        } finally {
          client.release()
        }

        if (isErr?.code === 403) {
          return reply.code(403).send()
        } else if (isErr?.code === 412) {
          return reply.code(412).send(encode(isErr))
        }

        return reply.code(204).send()
      } else {
        return reply.code(400).send()
      }
    } catch (err) {
      console.error(err)
      return reply.code(500).send(encode({ error: "Internal server error" }))
    }
  })

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

  fastify.post<{ Body: Uint8Array[] }>("/batch", batchContentSchema, async (req, reply) => {
    const user = await helpers.authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const input = req.body

    const objectIdStrings = input.map((id) => Buffer.from(id).toString("base64url"))

    try {
      const lookupRes = await fastify.pg.query<{ object_id: string; storage_id: string; version: bigint }>(
        `SELECT cp.object_id, cp.storage_id, cp.version
          FROM content_pointers cp
          LEFT JOIN follows f ON f.followee_id = cp.user_id
          WHERE (f.follower_id = $1 OR cp.user_id = $1)
            AND cp.object_id = ANY($2::TEXT[]);`,
        [user.userId, objectIdStrings],
      )

      if (lookupRes.rowCount !== objectIdStrings.length) {
        const foundIds = new Set(lookupRes.rows.map((r) => r.object_id))
        const notFound = objectIdStrings.filter((o) => !foundIds.has(o))

        const x = await fastify.pg.query<{ object_id: string; storage_id: string; version: bigint }>(
          `SELECT *
            FROM content_pointers cp
            LEFT JOIN follows f ON f.followee_id = cp.user_id
            WHERE cp.object_id = ANY($1::TEXT[]);`,
          [objectIdStrings],
        )

        reply
          .code(404)
          .type("application/cbor")
          .send(encode({ error: `Missing objectIds: ${notFound}` }))
      }

      const rowsByObjectId = new Map<string, { storageId: string; version: bigint }>()
      for (const row of lookupRes.rows) {
        rowsByObjectId.set(row.object_id, { storageId: row.storage_id, version: BigInt(row.version) })
      }

      for (const objectId of objectIdStrings) {
        if (!rowsByObjectId.has(objectId)) {
          throw new FetchError(objectId)
        }
      }

      const fetches = objectIdStrings.map(async (objectId) => {
        const { storageId, version } = rowsByObjectId.get(objectId)!

        const key = helpers.shardObjectKey(storageId)

        try {
          const obj = await s3.send(
            new GetObjectCommand({
              Bucket: config.bucketName,
              Key: key,
            }),
          )

          const body = await helpers.streamToBuffer(obj.Body as Readable)
          const nonce = obj.Metadata!["nonce"]!
          return { objectId, nonce, body, version }
        } catch (err) {
          if (isErrorWithName(err) && err.name === "NoSuchKey") {

            throw new FetchError(objectId)
          }
          throw err
        }
      })

      const results = await Promise.all(fetches)

      const responseMap: Record<string, { body: Buffer; nonce: string; version: bigint }> = {}
      for (const { objectId, body, nonce, version } of results) {
        responseMap[objectId] = { body, nonce, version }
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

  fastify.put("/avatar", putAvatarSchema, async (req, reply) => {
    const user = await helpers.authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const contentType = req.headers["content-type"]

    if (
      contentType === undefined ||
      (contentType !== "image/png" && contentType !== "image/jpeg" && contentType !== "image/svg+xml")
    ) {
      return reply.code(400).send(encode({ error: "Expected image content type" }))
    }

    const key = helpers.shardObjectKey(user.userId)

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

    const buffer = await helpers.streamToBuffer(req.raw as Readable)

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
  })

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

  fastify.get<{ Params: { userId: string } }>("/avatar/:userId", getAvatarSchema, async (req, reply) => {
    const user = await helpers.authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const userId = req.params.userId
    const key = helpers.shardObjectKey(userId)

    try {
      const obj = await s3.send(
        new GetObjectCommand({
          Bucket: config.bucketNamePublic,
          Key: key,
        }),
      )

      const avatar = await helpers.streamToBuffer(obj.Body as Readable)
      const mimeType = obj.ContentType ?? "application/octet-stream"
      return reply.code(200).type(mimeType).send(avatar)
    } catch (err) {
      if (isErrorWithName(err) && err.name === "NoSuchKey") {
        return reply.code(404).type("application/cbor").send()
      }
    }
  })
}
