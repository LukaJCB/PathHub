import {
  PostManifestPage,
  PostMeta,
  StorageIdentifier,
  PostManifest,
  Manifest,
  FollowerGroupState,
  InteractionComment,
  InteractionLike,
  Interaction,
  Entity,
  Comments,
  Likes,
} from "./manifest"
import { ClientState, createApplicationMessage, encode, mlsMessageEncoder, MlsContext } from "ts-mls"
import { encryptAndStore, encryptAndStoreWithPostSecret, replaceInPage } from "./createPost"
import {
  base64urlToUint8,
  RemoteStore,
  retreiveDecryptAndDecode,
  retrieveAndDecryptGroupState,
  uint8ToBase64Url,
} from "./remoteStore"
import { toBufferSource } from "ts-mls"
import {
  encodeComments,
  encodeCommentTbs,
  encodeFollowerGroupState,
  encodeLikes,
  encodeLikeTbs,
  encodeMessage,
  encodeMessagePublic,
} from "./codec/encode"
import { decodeComments, decodeLikes } from "./codec/decode"
import { Message, MessagePublic } from "./message"
import { MessageClient } from "./http/messageClient"
import { deriveGroupIdFromUserId, recipientsFromMlsState } from "./mlsInteractions"

export async function commentPost(
  text: string,
  meta: PostMeta,
  posterId: string,
  signingKey: CryptoKey,
  ownGroupState: ClientState,
  authorId: string,
  remoteStore: RemoteStore,
  messageClient: MessageClient,
  page: Entity<PostManifestPage>,
  pageId: StorageIdentifier,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  masterKey: Uint8Array,
  mls: MlsContext,
): Promise<{
  newManifest: [Entity<Manifest>, Entity<PostManifest>, Entity<PostManifestPage>, PostMeta] | undefined
  interaction: InteractionComment
}> {
  const commentTbs: CommentTbs = {
    postId: meta.main[0],
    author: authorId,
    date: Date.now(),
    text,
  }

  const comment = await signComment(signingKey, commentTbs)

  if (authorId === posterId) {
    return await interactOwnPost(
      meta,
      remoteStore,
      comment,
      ownGroupState,
      mls,
      page,
      pageId,
      postManifest,
      manifest,
      masterKey,
    )
  } else {
    const msg: Message = {
      kind: "Interaction",
      interaction: comment,
      posterId,
    }

    const followerGroupStateId = manifest.groupStates.get(uint8ToBase64Url(await deriveGroupIdFromUserId(posterId)))!
    const followerGroupState = await retrieveAndDecryptGroupState(
      remoteStore,
      uint8ToBase64Url(followerGroupStateId),
      masterKey,
    )
    const groupState = followerGroupState!.groupState
    const res = await createApplicationMessage({
      context: mls,
      state: groupState,
      message: encodeMessage(msg),
    })

    const mp: MessagePublic = {
      kind: "GroupMessage",
      mlsMessage: encode(mlsMessageEncoder, res.message),
    }

    const newFollowerGroupState: FollowerGroupState = {
      ...followerGroupState!,
      groupState: res.newState,
    }

    await Promise.all([
      messageClient.sendMessage({
        payload: encodeMessagePublic(mp),
        recipients: recipientsFromMlsState([authorId], groupState),
      }),
      encryptAndStoreWithPostSecret(
        masterKey,
        remoteStore,
        encodeFollowerGroupState(newFollowerGroupState),
        followerGroupStateId,
        followerGroupState!.version,
      ),
    ])

    return { interaction: comment, newManifest: undefined }
  }
}

export async function interactOwnPost<T extends Interaction>(
  meta: PostMeta,
  remoteStore: RemoteStore,
  interaction: T,
  ownGroupState: ClientState,
  mls: MlsContext,
  page: Entity<PostManifestPage>,
  pageId: StorageIdentifier,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  masterKey: Uint8Array,
): Promise<{
  newManifest: [Entity<Manifest>, Entity<PostManifest>, Entity<PostManifestPage>, PostMeta]
  interaction: T
}> {
  let newMeta: PostMeta
  if (interaction.kind === "comment") {
    const [comments, commentsVersion] = await updateCommentList(meta, remoteStore, interaction)

    const commentsEncoded = encodeComments(comments)

    //todo combine this with the below replaceInPage into a single transaction
    const storageIdentifier = await encryptAndStore(
      ownGroupState,
      mls,
      remoteStore,
      commentsEncoded,
      commentsVersion,
      meta.comments ? base64urlToUint8(meta.comments[0]) : undefined,
    )

    newMeta = {
      ...meta,
      totalComments: meta.totalComments + 1,
      sampleComments: [...meta.sampleComments.slice(1, meta.sampleComments.length), interaction],
      comments: storageIdentifier,
    }
  } else {
    const [likes, likesVersion] = await updateLikeList(meta, remoteStore, interaction)

    const likesEncoded = encodeLikes(likes)

    //todo combine this with the below replaceInPage into a single transaction
    const storageIdentifier = await encryptAndStore(
      ownGroupState,
      mls,
      remoteStore,
      likesEncoded,
      likesVersion,
      meta.likes ? base64urlToUint8(meta.likes[0]) : undefined,
    )

    newMeta = {
      ...meta,
      totalLikes: likes.likes.length,
      sampleLikes: [...meta.sampleLikes.slice(1, meta.sampleLikes.length), interaction],
      likes: storageIdentifier,
    }
  }

  //todo send mls message to everyone who has previously commented on the post
  const [newPage, newPostManifest, newManifest] = await replaceInPage(
    ownGroupState,
    mls,
    page,
    pageId,
    postManifest,
    manifest,
    masterKey,
    newMeta,
    remoteStore,
  )

  return { newManifest: [newManifest, newPostManifest, newPage, newMeta] as const, interaction }
}

export async function updateCommentList(
  meta: PostMeta,
  remoteStore: RemoteStore,
  comment: InteractionComment,
): Promise<[Comments, bigint]> {
  if (meta.comments) {
    const decoded = await retreiveDecryptAndDecode(remoteStore, meta.comments, decodeComments)

    console.log(decoded)
    return [{ comments: [comment, ...decoded!.comments] }, decoded!.version]
  } else {
    return [{ comments: [comment] }, 0n]
  }
}

export async function likePost(
  meta: PostMeta,
  signingKey: CryptoKey,
  mlsGroup: ClientState,
  ownPost: boolean,
  authorId: string,
  remoteStore: RemoteStore,
  page: Entity<PostManifestPage>,
  pageId: StorageIdentifier,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  masterKey: Uint8Array,
  mls: MlsContext,
): Promise<{
  interaction: InteractionLike
  newManifest: [Entity<Manifest>, Entity<PostManifest>, Entity<PostManifestPage>, PostMeta] | undefined
}> {
  const likeTbs: LikeTbs = {
    postId: meta.main[0],
    author: authorId,
    date: Date.now(),
  }

  const like = await signLike(signingKey, likeTbs)

  // const _content = encodeLike(like)

  //send like to mls group

  if (ownPost) {
    return await interactOwnPost(
      meta,
      remoteStore,
      like,
      mlsGroup,
      mls,
      page,
      pageId,
      postManifest,
      manifest,
      masterKey,
    )
  }

  return { interaction: like, newManifest: undefined }
}

export async function unlikePost(
  meta: PostMeta,
  mlsGroup: ClientState,
  ownPost: boolean,
  authorId: string,
  remoteStore: RemoteStore,
  page: Entity<PostManifestPage>,
  pageId: StorageIdentifier,
  postManifest: Entity<PostManifest>,
  manifest: Entity<Manifest>,
  masterKey: Uint8Array,
  mls: MlsContext,
): Promise<{
  newManifest: [Entity<Manifest>, Entity<PostManifest>, Entity<PostManifestPage>, PostMeta] | undefined
}> {
  //todo send unlike to mls group

  if (ownPost) {
    const [likes, likesVersion] = await removeFromLikeList(meta, remoteStore, authorId)

    const likesEncoded = encodeLikes(likes)

    //todo combine this with the below replaceInPage into a single transaction
    const storageIdentifier = await encryptAndStore(
      mlsGroup,
      mls,
      remoteStore,
      likesEncoded,
      likesVersion,
      meta.likes ? base64urlToUint8(meta.likes[0]) : undefined,
    )

    const newMeta: PostMeta = {
      ...meta,
      totalLikes: likes.likes.length,
      sampleLikes: meta.sampleLikes.filter((l) => l.author !== authorId),
      likes: storageIdentifier,
    }

    const [newPage, newPostManifest, newManifest] = await replaceInPage(
      mlsGroup,
      mls,
      page,
      pageId,
      postManifest,
      manifest,
      masterKey,
      newMeta,
      remoteStore,
    )

    return { newManifest: [newManifest, newPostManifest, newPage, newMeta] }
  }

  return { newManifest: undefined }
}

export async function updateLikeList(
  meta: PostMeta,
  remoteStore: RemoteStore,
  like: InteractionLike,
): Promise<[Likes, bigint]> {
  if (meta.likes) {
    const decoded = await retreiveDecryptAndDecode(remoteStore, meta.likes, decodeLikes)

    return [{ likes: [like, ...decoded!.likes] }, decoded!.version]
  } else {
    return [{ likes: [like] }, 0n]
  }
}

async function removeFromLikeList(
  meta: PostMeta,
  remoteStore: RemoteStore,
  authorId: string,
): Promise<[Likes, bigint]> {
  if (meta.likes) {
    const decoded = await retreiveDecryptAndDecode(remoteStore, meta.likes, decodeLikes)

    return [{ likes: decoded!.likes.filter((l) => l.author !== authorId) }, decoded!.version]
  } else {
    return Promise.reject(new Error("Could not retrieve likes from remote store"))
  }
}

async function signComment(signingKey: CryptoKey, tbs: CommentTbs): Promise<InteractionComment> {
  const encoded = encodeCommentTbs(tbs)

  const signature = await crypto.subtle.sign(
    {
      name: "Ed25519",
    },
    signingKey,
    toBufferSource(encoded),
  )

  return { ...tbs, signature: new Uint8Array(signature), kind: "comment" }
}

export interface CommentTbs {
  postId: string
  author: string
  date: number
  text: string
}

async function signLike(signingKey: CryptoKey, tbs: LikeTbs): Promise<InteractionLike> {
  const encoded = encodeLikeTbs(tbs)

  const signature = await crypto.subtle.sign(
    {
      name: "Ed25519",
    },
    signingKey,
    toBufferSource(encoded),
  )

  return { ...tbs, signature: new Uint8Array(signature), kind: "like" }
}

export interface LikeTbs {
  postId: string
  author: string
  date: number
}
