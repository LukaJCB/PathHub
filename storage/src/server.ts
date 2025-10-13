import dotenv from "dotenv"
import { build } from "./app.js"

const start = async () => {
  dotenv.config()

  const verificationKey = process.env.SIGNATURE_PUBLIC_KEY

  const minioEndpoint = process.env.S3_ENDPOINT || "http://localhost:9000"

  const minioAccessKeyId = process.env.S3_ACCESS_KEY || "minioadmin"

  const minioSecretAccessKey = process.env.S3_SECRET_KEY || "minioadmin"

  const bucketName = process.env.S3_BUCKET_NAME

  if (
    minioEndpoint === undefined ||
    minioAccessKeyId === undefined ||
    minioSecretAccessKey === undefined ||
    verificationKey === undefined ||
    bucketName === undefined
  )
    throw new Error("Invalid env")

  const verificationKeyData = Buffer.from(verificationKey, "base64url")

  const publicKey = await crypto.subtle.importKey("spki", verificationKeyData, "EdDSA", false, ["verify"])

  const app = await build({ minioAccessKeyId, minioEndpoint, minioSecretAccessKey, publicKey, bucketName })
  try {
    await app.listen({ port: 3000 })
    console.log("Server running at http://localhost:3000")
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

await start()
