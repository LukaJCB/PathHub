import { Comment, CurrentPostManifest, Like, PostMeta, StorageIdentifier } from "./manifest";
import {  CiphersuiteImpl, ClientState } from "ts-mls";
import { encryptAndStore, updatePostManifest } from "./createPost";
import { base64urlToUint8, RemoteStore, retrieveAndDecryptContent } from "./remoteStore";
import { toBufferSource } from "ts-mls/util/byteArray.js";
import { encodeComment, encodeComments, encodeCommentTbs, encodeLike, encodeLikes, encodeLikeTbs } from "./codec/encode";
import { decodeComments, decodeLikes } from "./codec/decode";


export async function commentPost(
  text: string,
  meta: PostMeta,
  signingKey: CryptoKey,
  mlsGroup: ClientState,
  ownPost: boolean,
  author: string,
  remoteStore: RemoteStore,
  manifest: CurrentPostManifest,
  manifestId: StorageIdentifier,
  impl: CiphersuiteImpl
): Promise<{ newManifest: [CurrentPostManifest, PostMeta] | undefined; comment: Comment; }> {
  const commentTbs: CommentTbs = {
    postId: meta.main[0],
    author,
    date: Date.now(),
    text
  }

  const comment = await signComment(signingKey, commentTbs)

  const content = encodeComment(comment)

  //send comment to mls group

  if (ownPost){
    const comments = await updateCommentList(meta, remoteStore, comment);
    
    const commentsEncoded = encodeComments(comments)

    const storageIdentifier = await encryptAndStore(mlsGroup,impl, remoteStore, commentsEncoded, meta.comments ? base64urlToUint8(meta.comments[0]) : undefined)

    const newMeta: PostMeta = {
      ...meta,
      totalComments: meta.totalComments + 1,
      sampleComments: [...meta.sampleComments.slice(1, meta.sampleComments.length), comment],
      comments: storageIdentifier
    }

    const newManifest = await updatePostManifest(manifest, newMeta, manifestId, remoteStore)

    return { newManifest: [newManifest, newMeta], comment }
  }

  return { comment, newManifest: undefined}

}


async function updateCommentList(meta: PostMeta, remoteStore: RemoteStore, comment: Comment): Promise<Comment[]> {
  if (meta.comments) {
    const decrypted = await retrieveAndDecryptContent(remoteStore, meta.comments);

    const decoded = decodeComments(new Uint8Array(decrypted))

    return [comment, ...decoded];
  } else {
    return [comment];

  }
}

export async function likePost(
  meta: PostMeta,
  signingKey: CryptoKey,
  mlsGroup: ClientState,
  ownPost: boolean,
  author: string,
  remoteStore: RemoteStore,
  manifest: CurrentPostManifest,
  manifestId: StorageIdentifier,
  impl: CiphersuiteImpl
): Promise<{ like: Like, newManifest: [CurrentPostManifest, PostMeta] | undefined}> {
  const likeTbs: LikeTbs = {
    postId: meta.main[0],
    author,
    date: Date.now(),
  }

  const like = await signLike(signingKey, likeTbs)

  const content = encodeLike(like)

  //send like to mls group

  if (ownPost){

    const likes = await updateLikeList(meta, remoteStore, like);
    
    const likesEncoded = encodeLikes(likes)

    const storageIdentifier = await encryptAndStore(mlsGroup, impl, remoteStore, likesEncoded, meta.likes ? base64urlToUint8(meta.likes[0]) : undefined)

    const newMeta: PostMeta = {
      ...meta,
      totalLikes: meta.totalLikes + 1,
      sampleLikes: [...meta.sampleLikes.slice(1, meta.sampleLikes.length), like],
      likes: storageIdentifier
    }

    const newManifest = await updatePostManifest(manifest, newMeta, manifestId, remoteStore)

    return { newManifest: [newManifest, newMeta], like }
  }

  return {like, newManifest: undefined}

}


async function updateLikeList(meta: PostMeta, remoteStore: RemoteStore, like: Like): Promise<Like[]> {
  if (meta.likes) {
    const decrypted = await retrieveAndDecryptContent(remoteStore, meta.likes);

    const decoded = decodeLikes(new Uint8Array(decrypted));

    return [like, ...decoded];
  } else {
    return [like];

  }
}

async function signComment(signingKey: CryptoKey, tbs: CommentTbs): Promise<Comment> {
  const encoded = encodeCommentTbs(tbs)

  const signature = await crypto.subtle.sign(
      {
        name: "Ed25519",
      },
      signingKey,
      toBufferSource(encoded),
    )

  return {...tbs, signature: new Uint8Array(signature)}
}

export interface CommentTbs  {
  postId: string
  author: string
  date: number
  text: string
}

async function signLike(signingKey: CryptoKey, tbs: LikeTbs): Promise<Like> {
  const encoded = encodeLikeTbs(tbs)

  const signature = await crypto.subtle.sign(
      {
        name: "Ed25519",
      },
      signingKey,
      toBufferSource(encoded),
    )

  return {...tbs, signature: new Uint8Array(signature)}
}


export interface LikeTbs  {
  postId: string
  author: string
  date: number
}
