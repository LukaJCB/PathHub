import dotenv from "dotenv"
import { build } from "./app.js"

const start = async () => {
  dotenv.config()

  const pgConnection = process.env.POSTGRES_CONNECTION_STRING

  const publicKey = process.env.SIGNATURE_PUBLIC_KEY

  const messageTtlSeconds = process.env.MESSAGE_TTL_SECONDS

  if (
    pgConnection === undefined ||
    publicKey === undefined ||
    messageTtlSeconds === undefined ||
    typeof messageTtlSeconds !== "number"
  )
    throw new Error("Invalid env")

  const verificationKeyData = Buffer.from(publicKey, "base64url")

  const verificationKey = await crypto.subtle.importKey("spki", verificationKeyData, "EdDSA", false, ["verify"])

  const app = await build({
    pgConnection,
    publicKey: verificationKey,
    messageTtlSeconds: messageTtlSeconds,
  })
  try {
    await app.listen({ port: 3000 })
    console.log("Server running at http://localhost:3000")
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

await start()
