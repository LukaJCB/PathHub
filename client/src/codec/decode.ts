import { decode } from "cbor-x";
import { Comment, CurrentPostManifest, Like, Manifest } from "../manifest";
import { CommentTbs, LikeTbs } from "../postInteraction";
import { ClientState } from "ts-mls";
import { fromJsonString } from "ts-mls/codec/json.js";
import { clientConfig } from "../mlsConfig";

export function decodeCurrentPostManifest(pm: Uint8Array): CurrentPostManifest {
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



export function decodeGroupState(gs: Uint8Array): ClientState {
    return fromJsonString(new TextDecoder().decode(gs), clientConfig)! //todo proper config
}


export function decodeManifest(m: Uint8Array): Manifest {
    return decode(m)
}