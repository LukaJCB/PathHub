import { StorageClient } from "./http/storageClient";


export async function getUserInfo(userId: string, storageClient: StorageClient): Promise<{ body: Uint8Array; contentType: string } | undefined> {
  return storageClient.getAvatar(userId)
}

export async function updateAvatar(avatar: Uint8Array, mimeType: string, storageClient: StorageClient): Promise<void> {
  switch (mimeType) {
    case "image/png":
    case "image/jpeg": 
    case "image/svg+xml":
      storageClient.putAvatar(avatar, mimeType)
      break;
    default: 
      throw new Error("Cannot upload avatar with unsupported mime type")
  }
  
}