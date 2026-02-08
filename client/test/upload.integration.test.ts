import { describe, it, expect, beforeAll } from "vitest"

import { createAuthClient, parseToken } from "../src/authClient.js"
import { createAuthenticationClient } from "../src/http/authenticationClient.js"
import { createContentClient } from "../src/http/storageClient.js"
import {
  createRemoteStore,
  retreiveDecryptAndDecode,
  retrieveAndDecryptPostManifestPage,
  uint8ToBase64Url,
} from "../src/remoteStore.js"
import { decodeComments, decodeFollowRequests, decodeLikes, decodeRoute } from "../src/codec/decode.js"
import { getOrCreateManifest } from "../src/init.js"
import { getUserInfo } from "../src/userInfo.js"
import { encodeRoute } from "../src/codec/encode.js"
import { createPost, derivePostSecret } from "../src/createPost.js"
import { encodeBlobWithMime } from "../src/imageEncoding.js"
import { commentPost, likePost, unlikePost } from "../src/postInteraction.js"
import { createMessageClient } from "../src/http/messageClient.js"

const authBaseUrl = "http://localhost:3000"
const contentBaseUrl = "http://localhost:3000"

describe("Auth init + File upload end-to-end", () => {
  const authClient = createAuthClient(authBaseUrl)

  const user = {
    username: `upload+${Date.now()}@example.com`,
    password: "secretA123!",
  }

  let token: string
  let manifestId: string
  let masterKey: Uint8Array

  beforeAll(async () => {
    await authClient.register(user)
    const login = await authClient.login(user)
    token = login.token
    manifestId = login.manifest
    masterKey = login.masterKey
  })

  it("initializes user state and uploads a route post", async () => {
    const { userId } = parseToken(token)
    const storageClient = createContentClient(contentBaseUrl, token)
    const rs = createRemoteStore(storageClient)

    const [manifest, postManifest, page, groupState, , mlsContext] = await getOrCreateManifest(
      userId,
      manifestId,
      masterKey,
      rs,
    )

    const followRequests = await retreiveDecryptAndDecode(
      rs,
      [uint8ToBase64Url(manifest.followRequests), masterKey],
      decodeFollowRequests,
    )

    const authHttpClient = createAuthenticationClient(authBaseUrl)
    const userInfo = await getUserInfo(userId, storageClient, authHttpClient, token)

    expect(followRequests).toBeDefined()
    expect(userInfo.info?.username).toBe(user.username)
    expect(userInfo.avatar).toBeDefined()

    const coords: [number, number, number][] = [
      [37.7749, -122.4194, 12],
      [37.7755, -122.418, 18],
      [37.7762, -122.4172, 15],
    ]

    const routeContent = encodeRoute({ coords })

    const thumbnailPayload = encodeBlobWithMime(new Uint8Array([137, 80, 78, 71]).buffer, "image/png")
    const mediaPayload = encodeBlobWithMime(new Uint8Array([255, 216, 255]).buffer, "image/jpeg")

    const [newGroup, newPage, newPostManifest, newManifest] = await createPost(
      routeContent,
      {
        distance: 1250,
        elevation: 45,
        duration: 900000,
      },
      "Mission Loop",
      thumbnailPayload,
      [mediaPayload],
      Date.now(),
      "Short test route",
      "Ride",
      "Test bike",
      userId,
      page,
      postManifest,
      groupState,
      manifest,
      rs,
      null as any,
      mlsContext,
      masterKey,
    )

    expect(newPostManifest.totals.totalPosts).toBe(postManifest.totals.totalPosts + 1)
    expect(newPage.posts.length).toBe(page.posts.length + 1)
    expect(newManifest.postManifest[0]).toBe(postManifest.storage[0])
    expect(newGroup.groupState).toBeDefined()

    const storedPage = await retrieveAndDecryptPostManifestPage(rs, newPostManifest.currentPage)
    expect(storedPage).toBeDefined()
    expect(storedPage!.posts[0]!.title).toBe("Mission Loop")

    const decodedRoute = await retreiveDecryptAndDecode(rs, newPage.posts[0]!.main, decodeRoute)
    expect(decodedRoute).toEqual(coords)
  })

  it("likes, comments, and unlikes the uploaded post", async () => {
    const { userId } = parseToken(token)
    const storageClient = createContentClient(contentBaseUrl, token)
    const rs = createRemoteStore(storageClient)
    const messager = createMessageClient(authBaseUrl, token)

    const [manifest, postManifest, page, groupState, , mlsContext] = await getOrCreateManifest(
      userId,
      manifestId,
      masterKey,
      rs,
    )

    const coords: [number, number, number][] = [
      [37.7749, -122.4194, 12],
      [37.7755, -122.418, 18],
      [37.7762, -122.4172, 15],
    ]

    const routeContent = encodeRoute({ coords })

    const thumbnailPayload = encodeBlobWithMime(new Uint8Array([137, 80, 78, 71]).buffer, "image/png")

    const [newGroup, newPage, newPostManifest, newManifest] = await createPost(
      routeContent,
      {
        distance: 1250,
        elevation: 45,
        duration: 900000,
      },
      "Mission Loop",
      thumbnailPayload,
      [],
      Date.now(),
      "Short test route",
      "Ride",
      "Test bike",
      userId,
      page,
      postManifest,
      groupState,
      manifest,
      rs,
      null as any,
      mlsContext,
      masterKey,
    )

    const postMeta = newPage.posts[0]!
    const signer = await crypto.subtle.generateKey("Ed25519", false, ["sign"])
    const signingKey = signer.privateKey

    const likeResult = await likePost(
      postMeta,
      signingKey,
      newGroup.groupState,
      true,
      userId,
      rs,
      newPage,
      newPage.storage,
      newPostManifest,
      newManifest,
      masterKey,
      mlsContext,
    )

    expect(likeResult.newManifest).toBeDefined()

    const [likedManifest, likedPostManifest, likedPage, likedPost] = likeResult.newManifest!

    const commentResult = await commentPost(
      "Great loop!",
      likedPost,
      userId,
      signingKey,
      newGroup.groupState,
      userId,
      rs,
      messager,
      likedPage,
      likedPage.storage,
      likedPostManifest,
      likedManifest,
      masterKey,
      mlsContext,
    )

    expect(commentResult.newManifest).toBeDefined()

    const [commentedManifest, commentedPostManifest, commentedPage, commentedPost] = commentResult.newManifest!

    expect(commentedPost.totalLikes).toBe(1)
    expect(commentedPost.totalComments).toBe(1)
    expect(commentedPage.posts[0]!.totalLikes).toBe(1)
    expect(commentedPage.posts[0]!.totalComments).toBe(1)
    expect(commentedManifest.postManifest[0]).toBe(commentedPostManifest.storage[0])

    const storedLikes = await retreiveDecryptAndDecode(rs, commentedPost.likes!, decodeLikes)
    const storedComments = await retreiveDecryptAndDecode(rs, commentedPost.comments!, decodeComments)

    expect(storedLikes?.likes.length).toBe(1)
    expect(storedLikes?.likes[0]!.author).toBe(userId)
    expect(storedComments?.comments.length).toBe(1)
    expect(storedComments?.comments[0]!.text).toBe("Great loop!")

    const unlikeResult = await unlikePost(
      commentedPost,
      newGroup.groupState,
      true,
      userId,
      rs,
      commentedPage,
      commentedPage.storage,
      commentedPostManifest,
      commentedManifest,
      masterKey,
      mlsContext,
    )

    expect(unlikeResult.newManifest).toBeDefined()

    const [unlikedManifest, unlikedPostManifest, unlikedPage, unlikedPost] = unlikeResult.newManifest!

    expect(unlikedPost.totalLikes).toBe(0)
    expect(unlikedPage.posts[0]!.totalLikes).toBe(0)
    expect(unlikedManifest.postManifest[0]).toBe(unlikedPostManifest.storage[0])

    const storedLikesAfter = await retreiveDecryptAndDecode(rs, unlikedPost.likes!, decodeLikes)
    expect(storedLikesAfter?.likes.length).toBe(0)
  })

  it("creates a new page when post limit is exceeded", async () => {
    const { userId } = parseToken(token)
    const storageClient = createContentClient(contentBaseUrl, token)
    const rs = createRemoteStore(storageClient)
    const overflowManifestId = uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(16)))

    let [manifest, postManifest, page, groupState, , mlsContext] = await getOrCreateManifest(
      userId,
      overflowManifestId,
      masterKey,
      rs,
    )

    const coords: [number, number, number][] = [
      [37.7749, -122.4194, 12],
      [37.7755, -122.418, 18],
      [37.7762, -122.4172, 15],
    ]

    const thumbnailPayload = encodeBlobWithMime(new Uint8Array([137, 80, 78, 71]).buffer, "image/png")
    const postLimitOverride = 2

    const createTestPost = async (title: string) => {
      const routeContent = encodeRoute({ coords })
      const result = await createPost(
        routeContent,
        {
          distance: 1250,
          elevation: 45,
          duration: 900000,
        },
        title,
        thumbnailPayload,
        [],
        Date.now(),
        "Short test route",
        "Ride",
        "Test bike",
        userId,
        page,
        postManifest,
        groupState,
        manifest,
        rs,
        null as any,
        mlsContext,
        masterKey,
        postLimitOverride,
      )

      ;[groupState, page, postManifest, manifest] = result
    }

    await createTestPost("Post 1")
    expect(page.pageIndex).toBe(0)
    expect(page.posts.length).toBe(1)

    await createTestPost("Post 2")
    const pageBeforeOverflow = page
    const previousCurrentPage = postManifest.currentPage
    expect(pageBeforeOverflow.posts.length).toBe(2)

    await createTestPost("Post 3")
    expect(page.pageIndex).toBe(1)
    expect(page.posts.length).toBe(1)
    expect(postManifest.pages.length).toBeGreaterThan(0)
    expect(postManifest.pages.at(-1)!.page[0]).toBe(previousCurrentPage[0])

    const storedOldPage = await retrieveAndDecryptPostManifestPage(rs, pageBeforeOverflow.storage)
    expect(storedOldPage).toBeDefined()
    expect(storedOldPage!.posts.length).toBe(2)
    expect(storedOldPage!.posts[0]!.title).toBe("Post 2")
    expect(storedOldPage!.posts[1]!.title).toBe("Post 1")
  })

  it("likes and comments a post on a non-current page", async () => {
    const { userId } = parseToken(token)
    const storageClient = createContentClient(contentBaseUrl, token)
    const rs = createRemoteStore(storageClient)
    const messager = createMessageClient(authBaseUrl, token)
    const overflowManifestId = uint8ToBase64Url(crypto.getRandomValues(new Uint8Array(16)))

    let [manifest, postManifest, page, groupState, , mlsContext] = await getOrCreateManifest(
      userId,
      overflowManifestId,
      masterKey,
      rs,
    )

    const coords: [number, number, number][] = [
      [37.7749, -122.4194, 12],
      [37.7755, -122.418, 18],
      [37.7762, -122.4172, 15],
    ]

    const thumbnailPayload = encodeBlobWithMime(new Uint8Array([137, 80, 78, 71]).buffer, "image/png")
    const postLimitOverride = 2

    const createTestPost = async (title: string) => {
      const routeContent = encodeRoute({ coords })
      const result = await createPost(
        routeContent,
        {
          distance: 1250,
          elevation: 45,
          duration: 900000,
        },
        title,
        thumbnailPayload,
        [],
        Date.now(),
        "Short test route",
        "Ride",
        "Test bike",
        userId,
        page,
        postManifest,
        groupState,
        manifest,
        rs,
        null as any,
        mlsContext,
        masterKey,
        postLimitOverride,
      )

      ;[groupState, page, postManifest, manifest] = result
    }

    await createTestPost("Post 1")
    await createTestPost("Post 2")
    await createTestPost("Post 3")

    const currentPage = page
    const previousPageRef = postManifest.pages[0]!.page
    const oldPage = await retrieveAndDecryptPostManifestPage(rs, previousPageRef)

    expect(oldPage).toBeDefined()

    const oldPost = oldPage!.posts[0]!
    const signer = await crypto.subtle.generateKey("Ed25519", false, ["sign"])
    const signingKey = signer.privateKey
    const currentPostSecret = await derivePostSecret(groupState.groupState, mlsContext.cipherSuite)

    const likeResult = await likePost(
      oldPost,
      signingKey,
      groupState.groupState,
      true,
      userId,
      rs,
      oldPage!,
      oldPage!.storage,
      postManifest,
      manifest,
      masterKey,
      mlsContext,
    )

    expect(likeResult.newManifest).toBeDefined()

    let [manifestAfterLike, postManifestAfterLike, pageAfterLike, postAfterLike] = likeResult.newManifest!

    expect(pageAfterLike.storage[0]).toBe(oldPage!.storage[0])
    expect(pageAfterLike.storage[1]).toEqual(currentPostSecret)
    expect(postManifestAfterLike.currentPage[0]).toBe(currentPage.storage[0])

    const oldPageEntryAfterLike = postManifestAfterLike.pages.find((p) => p.page[0] === oldPage!.storage[0])
    expect(oldPageEntryAfterLike).toBeDefined()
    expect(oldPageEntryAfterLike!.page[1]).toEqual(currentPostSecret)

    const commentResult = await commentPost(
      "Off-page comment",
      postAfterLike,
      userId,
      signingKey,
      groupState.groupState,
      userId,
      rs,
      messager,
      pageAfterLike,
      pageAfterLike.storage,
      postManifestAfterLike,
      manifestAfterLike,
      masterKey,
      mlsContext,
    )

    expect(commentResult.newManifest).toBeDefined()
    ;[manifestAfterLike, postManifestAfterLike, pageAfterLike, postAfterLike] = commentResult.newManifest!

    expect(postAfterLike.totalLikes).toBe(1)
    expect(postAfterLike.totalComments).toBe(1)
    expect(postManifestAfterLike.currentPage[0]).toBe(currentPage.storage[0])

    const storedLikes = await retreiveDecryptAndDecode(rs, postAfterLike.likes!, decodeLikes)
    const storedComments = await retreiveDecryptAndDecode(rs, postAfterLike.comments!, decodeComments)

    expect(storedLikes?.likes.length).toBe(1)
    expect(storedComments?.comments.length).toBe(1)
    expect(storedComments?.comments[0]!.text).toBe("Off-page comment")
  })
})
