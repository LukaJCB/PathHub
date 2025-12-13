import dotenv from "dotenv"
import { build } from "./app.js"

const start = async () => {
  dotenv.config()

  const pgConnection = process.env.POSTGRES_CONNECTION_STRING

  const publicKey = process.env.SIGNATURE_PUBLIC_KEY

  const messageTtlSeconds = process.env.MESSAGE_TTL_SECONDS

  const ttl = parseInt(messageTtlSeconds!)

  if (
    pgConnection === undefined ||
    publicKey === undefined ||
    messageTtlSeconds === undefined
  )
    throw new Error("Invalid env: " + (typeof messageTtlSeconds))

  const verificationKeyData = Buffer.from(publicKey, "base64url")
  const verificationKey = await crypto.subtle.importKey("spki", verificationKeyData, "Ed25519", true, ["verify"])

  const app = await build({
    pgConnection,
    publicKey: verificationKey,
    messageTtlSeconds: ttl,
  })
  try {
    await app.listen({ port: 3002 })
    console.log("Server running at http://localhost:3002")
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

await start()
