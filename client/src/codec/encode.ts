import { encode } from "cbor-x";
import { Comment, PostManifestPage, Like, Manifest, PostManifest } from "../manifest";
import { CommentTbs, LikeTbs } from "../postInteraction";
import { ClientState } from "ts-mls";
import { toJsonString } from "ts-mls/codec/json.js";

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

export function encodeGroupState(gs: ClientState): Uint8Array {
    return new TextEncoder().encode(toJsonString(gs))
}


export function encodeFollowRequests(reqs: Uint8Array[]): Uint8Array {
    return encode(reqs)
}


export function encodePostManifest(m: PostManifest): Uint8Array {
    return encode(m)
}


export function encodeManifest(m: Manifest): Uint8Array {
    return encode(m)
}