import { Comment, PostManifestPage, Like, PostMeta, StorageIdentifier, PostManifest, Manifest } from "./manifest";
import {  CiphersuiteImpl, ClientState } from "ts-mls";
import { encryptAndStore, replaceInPage } from "./createPost";
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
  authorId: string,
  remoteStore: RemoteStore,
  page: PostManifestPage,
  pageId: StorageIdentifier,
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  impl: CiphersuiteImpl
): Promise<{ newManifest: [Manifest, PostManifest, PostManifestPage, PostMeta] | undefined; comment: Comment; }> {
  const commentTbs: CommentTbs = {
    postId: meta.main[0],
    author: authorId,
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

    const [newPage, newPostManifest, newManifest] = await replaceInPage(mlsGroup, impl, page, pageId, postManifest, manifest, manifestId, masterKey, newMeta, remoteStore)

    return { newManifest: [newManifest, newPostManifest, newPage, newMeta], comment }
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
  authorId: string,
  remoteStore: RemoteStore,
  page: PostManifestPage,
  pageId: StorageIdentifier,
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  impl: CiphersuiteImpl
): Promise<{ like: Like, newManifest: [Manifest, PostManifest, PostManifestPage, PostMeta] | undefined}> {
  const likeTbs: LikeTbs = {
    postId: meta.main[0],
    author: authorId,
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
      totalLikes: likes.length,
      sampleLikes: [...meta.sampleLikes.slice(1, meta.sampleLikes.length), like],
      likes: storageIdentifier
    }


    const [newPage, newPostManifest, newManifest] = await replaceInPage(mlsGroup, impl, page, pageId, postManifest, manifest, manifestId, masterKey, newMeta, remoteStore)

    return { newManifest: [newManifest, newPostManifest, newPage, newMeta], like }
  }

  return {like, newManifest: undefined}

}

export async function unlikePost(
  meta: PostMeta,
  mlsGroup: ClientState,
  ownPost: boolean,
  authorId: string,
  remoteStore: RemoteStore,
 page: PostManifestPage,
  pageId: StorageIdentifier,
  postManifest: PostManifest,
  manifest: Manifest,
  manifestId: Uint8Array,
  masterKey: Uint8Array,
  impl: CiphersuiteImpl
): Promise<{ newManifest: [Manifest, PostManifest, PostManifestPage, PostMeta] | undefined}> {

  //send like to mls group

  if (ownPost) {

    const likes = await removeFromLikeList(meta, remoteStore, authorId);
    
    const likesEncoded = encodeLikes(likes)

    const storageIdentifier = await encryptAndStore(mlsGroup, impl, remoteStore, likesEncoded, meta.likes ? base64urlToUint8(meta.likes[0]) : undefined)

    const newMeta: PostMeta = {
      ...meta,
      totalLikes: likes.length,
      sampleLikes: meta.sampleLikes.filter(l => l.author !== authorId),
      likes: storageIdentifier
    }

    
    const [newPage, newPostManifest, newManifest] = await replaceInPage(mlsGroup, impl, page, pageId, postManifest, manifest, manifestId, masterKey, newMeta, remoteStore)

    return { newManifest: [newManifest, newPostManifest, newPage, newMeta] }
  }

  return {newManifest: undefined}

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

async function removeFromLikeList(meta: PostMeta, remoteStore: RemoteStore, authorId: string): Promise<Like[]> {
  if (meta.likes) {
    const decrypted = await retrieveAndDecryptContent(remoteStore, meta.likes);

    const decoded = decodeLikes(new Uint8Array(decrypted));

    return decoded.filter(l => l.author !== authorId)
  } else {
    return Promise.reject(new Error("Could not retrieve likes from remote store"))
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
