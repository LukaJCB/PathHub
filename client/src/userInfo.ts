import { AuthClient } from "./http/authenticationClient";
import { StorageClient } from "./http/storageClient";

export interface UserInfo {
  avatar: { body: Uint8Array; contentType: string } | undefined
  info: { username: string, key: Uint8Array } | undefined
}

//todo better handle the token & clients
export async function getUserInfo(userId: string, storageClient: StorageClient, authClient: AuthClient, token: string): Promise<UserInfo> {
  const avatar = await storageClient.getAvatar(userId)
  const info = await authClient.getUserInfo([userId], token)
  return { avatar, info: info.at(0) }
}

export async function updateAvatar(avatar: Uint8Array, mimeType: string, storageClient: StorageClient): Promise<void> {
  switch (mimeType) {
    case "image/png":
    case "image/jpeg": 
    case "image/svg+xml":
      await storageClient.putAvatar(avatar, mimeType)
      break;
    default: 
      throw new Error("Cannot upload avatar with unsupported mime type")
  }
  
}