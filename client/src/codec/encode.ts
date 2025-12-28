import { encode } from "cbor-x";
import { Comment, PostManifestPage, Like, Manifest, PostManifest, FollowerManifest } from "../manifest";
import { CommentTbs, LikeTbs } from "../postInteraction";
import { ClientState, encodeGroupState, PrivateKeyPackage } from "ts-mls";
import { toJsonString } from "ts-mls/codec/json.js";
import { FollowRequests } from "../followRequest";
import { MessagePublic } from "../message";

export function encodePostManifestPage(pm: PostManifestPage): Uint8Array {
    return encode(pm)
}

export function encodeComment(c: Comment): Uint8Array {
    return encode(c)
}

export function encodeComments(cs: Comment[]): Uint8Array {
    return encode(cs)
}

export function encodeCommentTbs(c: CommentTbs): Uint8Array {
    return encode(c)
}


export function encodeLike(l: Like): Uint8Array {
    return encode(l)
}

export function encodeLikes(ls: Like[]): Uint8Array {
    return encode(ls)
}

export function encodeLikeTbs(l: LikeTbs): Uint8Array {
    return encode(l)
}


export function encodeRoute(r: [number, number, number][]): Uint8Array {
    return encode(r)
}

export function encodeClientState(gs: ClientState): Uint8Array {
    return encodeGroupState(gs)
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

export function encodeFollowerManifest(reqs: FollowerManifest): Uint8Array {
    return encode(reqs)
}

export function encodeMessagePublic(mp: MessagePublic): Uint8Array {
    return encode(mp)
}

export function encodeManifest(m: Manifest): Uint8Array {
    return encode(m)
}