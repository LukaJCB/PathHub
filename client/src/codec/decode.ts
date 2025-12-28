import { decode } from "cbor-x";
import { Comment, PostManifestPage, Like, Manifest, PostManifest, FollowerManifest } from "../manifest";
import { CommentTbs, LikeTbs } from "../postInteraction";
import { ClientState, decodeGroupState, GroupState, PrivateKeyPackage } from "ts-mls";
import { fromJsonString } from "ts-mls/codec/json.js";
import { clientConfig } from "../mlsConfig";
import { FollowRequests } from "../followRequest";
import { MessagePublic } from "../message";

export function decodePostManifestPage(pm: Uint8Array): PostManifestPage {
    return decode(pm)
}

export function decodeComment(c: Uint8Array): Comment {
    return decode(c)
}

export function decodeComments(cs: Uint8Array): Comment[] {
    return decode(cs)
}

export function decodeCommentTbs(c: Uint8Array): CommentTbs {
    return decode(c)
}


export function decodeLike(l: Uint8Array): Like {
    return decode(l)
}

export function decodeLikes(ls: Uint8Array): Like[] {
    return decode(ls)
}

export function decodeLikeTbs(l: Uint8Array): LikeTbs {
    return decode(l)
}


export function decodeRoute(r: Uint8Array): [number, number, number][] {
    return decode(r)
}



export function decodeClientState(gs: Uint8Array): ClientState {
    return {...decodeGroupState(gs, 0)![0], clientConfig: clientConfig } //todo proper config
}


export function decodeFollowRequests(reqs: Uint8Array): FollowRequests {
    return decode(reqs)
}

//todo replace within ts-mls
export function decodePrivateKeyPackage(pkp: Uint8Array): PrivateKeyPackage {
    return decode(pkp)
}


export function decodeManifest(m: Uint8Array): Manifest {
    return decode(m)
}

export function decodeFollowerManifest(m: Uint8Array): FollowerManifest {
    return decode(m)
}


export function decodeMessagePublic(mp: Uint8Array): MessagePublic {
    return decode(mp)
}

export function decodePostManifest(m: Uint8Array): PostManifest {
    return decode(m)
}