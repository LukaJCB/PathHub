import Fastify from "fastify"
import { encode } from "cbor-x"

interface SendMessageBody {
  payload: Uint8Array
  recipients: string[]
}

export async function registerMessageRoutes(
  fastify: Fastify.FastifyInstance,
  config: {
    messageTtlSeconds?: number
  },
  helpers: {
    authenticate: (
      auth: string | undefined,
    ) => Promise<{ status: "ok"; userId: string; username: string } | { status: "error" }>
  },
) {
  const messageTtlSeconds = config.messageTtlSeconds ?? 86400 // Default to 24 hours

  const sendMessageSchema = {
    schema: {
      body: {
        type: "object",
        required: ["payload", "recipients"],
        properties: {
          payload: { type: "object" },
          recipients: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1,
          },
        },
      },
      response: {
        201: {
          type: "object",
          properties: {
            id: { type: "string", format: "uuid" },
          },
        },
        401: {
          type: "object",
        },
      },
    },
  }

  fastify.post<{ Body: SendMessageBody }>("", sendMessageSchema, async (req, reply) => {
    const user = await helpers.authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const { payload, recipients } = req.body

    const messageId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + messageTtlSeconds * 1000)

    await fastify.pg.transact(async (client) => {
      await client.query(`INSERT INTO messages (id, sender_id, payload, expires_at) VALUES ($1, $2, $3, $4)`, [
        messageId,
        user.userId,
        Buffer.from(payload),
        expiresAt,
      ])

      for (const recipient of recipients) {
        await client.query(`INSERT INTO message_recipients (message_id, recipient_id) VALUES ($1, $2)`, [
          messageId,
          recipient,
        ])
      }
    })

    return reply
      .code(201)
      .type("application/cbor")
      .send(encode({ id: messageId }))
  })

  const receiveMessagesSchema = {
    schema: {
      response: {
        200: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "sender", "payload"],
            properties: {
              id: { type: "string", format: "uuid" },
              sender: { type: "string", format: "uuid" },
              payload: { type: "object" },
            },
          },
        },
        401: {
          type: "object",
        },
      },
    },
  }

  fastify.get("", receiveMessagesSchema, async (req, reply) => {
    const user = await helpers.authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const result = await fastify.pg.query<{
      id: string
      sender: string
      payload: Buffer
    }>(
      `
      SELECT m.id, m.sender_id as sender, m.payload
      FROM messages m
      JOIN message_recipients r ON r.message_id = m.id
      WHERE r.recipient_id = $1 AND r.received_at IS NULL AND m.expires_at > NOW()
      `,
      [user.userId],
    )

    const messages = result.rows.map((row) => ({
      id: row.id,
      sender: row.sender,
      payload: row.payload,
    }))

    return reply.type("application/cbor").send(encode(messages))
  })

  const ackMessageSchema = {
    schema: {
      body: {
        type: "object",
        required: ["messageIds"],
        properties: {
          messageIds: {
            type: "array",
            items: { type: "string", format: "uuid" },
            minItems: 1,
          },
        },
      },
      response: {
        204: { type: "null" },
        400: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
        401: {
          type: "object",
        },
        404: {
          type: "object",
          properties: {
            error: { type: "string" },
          },
        },
      },
    },
  }

  fastify.post<{ Body: { messageIds: string[] } }>("/ack", ackMessageSchema, async (req, reply) => {
    const user = await helpers.authenticate(req.headers.authorization)
    if (user.status === "error") return reply.code(401).type("application/cbor").send()

    const { messageIds } = req.body

    const now = new Date()

    try {
      await fastify.pg.transact(async (client) => {
        for (const msgId of messageIds) {
          const res = await client.query(
            `UPDATE message_recipients
              SET received_at = $1
              WHERE message_id = $2 AND recipient_id = $3`,
            [now, msgId, user.userId],
          )

          if (res.rowCount === 0) {
            throw new AckError(`Not found: ${msgId}`)
          }
        }
      })

      return reply.code(204).send()
    } catch (err) {
      if (err instanceof AckError) {
        return reply
          .code(404)
          .type("application/cbor")
          .send(encode({ error: err.message }))
      }
      throw err
    }
  })
}

class AckError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AckError"
  }
}
