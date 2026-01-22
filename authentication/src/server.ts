import dotenv from "dotenv"
import { build } from "./app.js"
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3"

const start = async () => {
  dotenv.config()
  const serverSetup = process.env.OPAQUE_SERVER_SETUP

  const pgConnection = process.env.POSTGRES_CONNECTION_STRING

  const privateKey = process.env.SIGNATURE_PRIVATE_KEY

  const publicKey = process.env.SIGNATURE_PUBLIC_KEY

  const keyId = process.env.SIGNATURE_KEY_ID

  const minioEndpoint = process.env.S3_ENDPOINT || "http://localhost:9000"

  const minioAccessKeyId = process.env.S3_ACCESS_KEY || "minioadmin"

  const minioSecretAccessKey = process.env.S3_SECRET_KEY || "minioadmin"

  const bucketName = process.env.S3_BUCKET_NAME

  const bucketNamePublic = process.env.S3_PUBLIC_BUCKET_NAME

  if (
    serverSetup === undefined ||
    pgConnection === undefined ||
    privateKey === undefined ||
    publicKey === undefined ||
    keyId === undefined ||
    minioEndpoint === undefined ||
    minioAccessKeyId === undefined ||
    minioSecretAccessKey === undefined ||
    bucketName === undefined ||
    bucketNamePublic === undefined
  )
    throw new Error("Invalid env")

  const signKeyData = Buffer.from(privateKey, "base64url")
  const verificationKeyData = Buffer.from(publicKey, "base64url")

  const signingKey = await crypto.subtle.importKey("pkcs8", signKeyData, "Ed25519", false, ["sign"])
  const verificationKey = await crypto.subtle.importKey("spki", verificationKeyData, "Ed25519", true, ["verify"])

  const s3 = new S3Client({
    region: "us-east-1",
    endpoint: minioEndpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: minioAccessKeyId,
      secretAccessKey: minioSecretAccessKey,
    },
  })

  try {
    await Promise.all([
      s3.send(
        new CreateBucketCommand({
          Bucket: bucketName,
        }),
      ),
      s3.send(
        new CreateBucketCommand({
          Bucket: bucketNamePublic,
        }),
      ),
    ])
  } catch (e) {
    if (e instanceof Error && e.name !== "BucketAlreadyOwnedByYou") {
      throw e
    }
  }

  s3.destroy()

  const app = await build({
    opaqueSecret: serverSetup,
    pgConnection,
    signingKey,
    publicKey: verificationKey,
    publicKeyId: keyId,
    minioEndpoint,
    minioAccessKeyId,
    minioSecretAccessKey,
    bucketName,
    bucketNamePublic,
    messageTtlSeconds: 86400,
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
