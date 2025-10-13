import dotenv from "dotenv"
import { build } from "./app.js"

const start = async () => {
  dotenv.config()
  const serverSetup = process.env.OPAQUE_SERVER_SETUP

  const pgConnection = process.env.POSTGRES_CONNECTION_STRING

  const privateKey = process.env.SIGNATURE_PRIVATE_KEY

  const publicKey = process.env.SIGNATURE_PUBLIC_KEY

  const keyId = process.env.SIGNATURE_KEY_ID

  if (
    serverSetup === undefined ||
    pgConnection === undefined ||
    privateKey === undefined ||
    publicKey === undefined ||
    keyId === undefined
  )
    throw new Error("Invalid env")

  const signKeyData = Buffer.from(privateKey, "base64url")
  const verificationKeyData = Buffer.from(publicKey, "base64url")

  const signingKey = await crypto.subtle.importKey("spki", signKeyData, "EdDSA", false, ["sign"])
  const verificationKey = await crypto.subtle.importKey("spki", verificationKeyData, "EdDSA", false, ["verify"])

  const app = await build({
    opaqueSecret: serverSetup,
    pgConnection,
    signingKey,
    publicKey: verificationKey,
    publicKeyId: keyId,
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
