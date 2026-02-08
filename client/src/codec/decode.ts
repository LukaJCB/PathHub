import { decode } from "cbor-x"
import {
  PostManifestPage,
  Manifest,
  PostManifest,
  FollowerManifest,
  FollowerGroupState,
  InteractionComment,
  InteractionLike,
  BaseInteraction,
  Interaction,
  Comments,
  Likes,
  Route,
} from "../manifest"
import { CommentTbs, LikeTbs } from "../postInteraction"
import { ClientState, PrivateKeyPackage, decode as decodeMls, clientStateDecoder } from "ts-mls"
import { FollowRequests } from "../followRequest"
import { Message, MessagePublic } from "../message"

export function decodePostManifestPage(pm: Uint8Array): PostManifestPage {
  return decode(pm) as PostManifestPage
}

export function decodeComment(c: Uint8Array): InteractionComment {
  return decode(c) as InteractionComment
}

export function decodeInteractions(c: Uint8Array): BaseInteraction[] {
  return decode(c) as BaseInteraction[]
}

export function decodeComments(cs: Uint8Array): Comments {
  return decode(cs) as Comments
}

export function decodeCommentTbs(c: Uint8Array): CommentTbs {
  return decode(c) as CommentTbs
}

export function decodeLike(l: Uint8Array): InteractionLike {
  return decode(l) as InteractionLike
}

export function decodeLikes(ls: Uint8Array): Likes {
  return decode(ls) as Likes
}

export function decodeLikeTbs(l: Uint8Array): LikeTbs {
  return decode(l) as LikeTbs
}

export function decodeRoute(r: Uint8Array): Route {
  return decode(r) as Route
}

export function decodeClientState(gs: Uint8Array): ClientState {
  return decodeMls(clientStateDecoder, gs)!
}

export function decodeFollowRequests(reqs: Uint8Array): FollowRequests {
  return decode(reqs) as FollowRequests
}

//todo replace within ts-mls
export function decodePrivateKeyPackage(pkp: Uint8Array): PrivateKeyPackage {
  return decode(pkp) as PrivateKeyPackage
}

export function decodeManifest(m: Uint8Array): Manifest {
  return decode(m) as Manifest
}

export function decodeMessage(m: Uint8Array): Message {
  return decode(m) as Message
}

export function decodeFollowerManifest(m: Uint8Array): FollowerManifest {
  return decode(m) as FollowerManifest
}

export function decodeFollowerGroupState(m: Uint8Array): FollowerGroupState {
  const x = decode(m) as {
    groupState: Uint8Array
    cachedInteractions: Map<string, Interaction[]>
  }

  return { groupState: decodeClientState(x.groupState), cachedInteractions: x.cachedInteractions }
}

export function decodeMessagePublic(mp: Uint8Array): MessagePublic {
  return decode(mp) as MessagePublic
}

export function decodePostManifest(m: Uint8Array): PostManifest {
  return decode(m) as PostManifest
}
