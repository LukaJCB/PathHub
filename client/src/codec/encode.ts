import { encode } from "cbor-x"
import {
  PostManifestPage,
  Manifest,
  PostManifest,
  FollowerManifest,
  FollowerGroupState,
  InteractionLike,
  InteractionComment,
  Comments,
  Likes,
} from "../manifest"
import { CommentTbs, LikeTbs } from "../postInteraction"
import { ClientState, clientStateEncoder, PrivateKeyPackage, encode as encodeMls } from "ts-mls"

import { FollowRequests } from "../followRequest"
import { Message, MessagePublic } from "../message"
import { ExtraInstruction } from "../createPost"

export function encodePostManifestPage(pm: PostManifestPage): Uint8Array {
  return encode(pm)
}

export function encodeComment(c: InteractionComment): Uint8Array {
  return encode(c)
}

export function encodeComments(cs: Comments): Uint8Array {
  return encode(cs)
}

export function encodeCommentTbs(c: CommentTbs): Uint8Array {
  return encode(c)
}

export function encodeLike(l: InteractionLike): Uint8Array {
  return encode(l)
}

export function encodeLikes(ls: Likes): Uint8Array {
  return encode(ls)
}

export function encodeLikeTbs(l: LikeTbs): Uint8Array {
  return encode(l)
}

export function encodeRoute(r: [number, number, number][]): Uint8Array {
  return encode(r)
}

export function encodeClientState(gs: ClientState): Uint8Array {
  return encodeMls(clientStateEncoder, gs)
}

export function encodeFollowerGroupState(fgs: FollowerGroupState): Uint8Array {
  const withEncoded = { groupState: encodeClientState(fgs.groupState), cachedInteractions: fgs.cachedInteractions }
  return encode(withEncoded)
}

export function encodeFollowRequests(reqs: FollowRequests): Uint8Array {
  return encode(reqs)
}

//todo replace within ts-mls
export function encodePrivateKeyPackage(pkp: PrivateKeyPackage): Uint8Array {
  return encode(pkp)
}

export function encodePostManifest(m: PostManifest): Uint8Array {
  return encode(m)
}

export function encodeExtraInstruction(m: ExtraInstruction): Uint8Array {
  return encode(m)
}

export function encodeFollowerManifest(reqs: FollowerManifest): Uint8Array {
  return encode(reqs)
}

export function encodeMessagePublic(mp: MessagePublic): Uint8Array {
  return encode(mp)
}

export function encodeMessage(mp: Message): Uint8Array {
  return encode(mp)
}

export function encodeManifest(m: Manifest): Uint8Array {
  return encode(m)
}
