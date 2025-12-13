import { LocalStore } from "./localStore";


export async function getProfile(userId: string, store: LocalStore) {
  //get manifest

  //fetch first x posts

  const manifest = await store.getCurrentManifest(userId)

  if (!manifest) throw new Error("")

  manifest.posts
}