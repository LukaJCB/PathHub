import dotenv from "dotenv"
import { build } from "./app.js"
import { CreateBucketCommand, S3Client } from "@aws-sdk/client-s3"

const start = async () => {
  dotenv.config()

  const verificationKey = process.env.SIGNATURE_PUBLIC_KEY

  const minioEndpoint = process.env.S3_ENDPOINT || "http://localhost:9000"

  const minioAccessKeyId = process.env.S3_ACCESS_KEY || "minioadmin"

  const minioSecretAccessKey = process.env.S3_SECRET_KEY || "minioadmin"

  const bucketName = process.env.S3_BUCKET_NAME

  const bucketNamePublic = process.env.S3_PUBLIC_BUCKET_NAME

  if (
    minioEndpoint === undefined ||
    minioAccessKeyId === undefined ||
    minioSecretAccessKey === undefined ||
    verificationKey === undefined ||
    bucketName === undefined ||
    bucketNamePublic === undefined
  )
    throw new Error("Invalid env")

  const verificationKeyData = Buffer.from(verificationKey, "base64url")

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
    await Promise.all([s3.send(
      new CreateBucketCommand({
        Bucket: bucketName,
      }),
    ), s3.send(
      new CreateBucketCommand({
        Bucket: bucketNamePublic,
      }),
    )])
  } catch (e: any) {
    if (e.name !== "BucketAlreadyOwnedByYou") {
      throw e
    }
  }

  s3.destroy()

  const publicKey = await crypto.subtle.importKey("spki", verificationKeyData, "Ed25519", false, ["verify"])

  const app = await build({ minioAccessKeyId, minioEndpoint, minioSecretAccessKey, publicKey, bucketName, bucketNamePublic })
  try {
    await app.listen({ port: 3001 })
    console.log("Server running at http://localhost:3001")
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

await start()
