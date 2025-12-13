import { ClientState } from "ts-mls"
import { Manifest } from "./manifest"
import { encode } from "cbor-x"

export function encodeBackup(
  groupStates: Map<string, ClientState>,
  manifest: Manifest,
  followeeManifests: Map<string, Manifest>,
  masterKey: CryptoKey,
) {
  encode({ groupStates, manifest, followeeManifests, masterKey })
}
