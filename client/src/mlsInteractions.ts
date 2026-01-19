import { ClientState, defaultCredentialTypes, nodeTypes } from "ts-mls";

import { getUserIdFromCredential } from "./init";

//todo use array instead of individual strings
export function recipientsFromMlsState(exclude: string[], clientState: ClientState): string[] {
  const recipients = []
  for (const x of clientState.ratchetTree) {
    if (x?.nodeType === nodeTypes.leaf && x.leaf.credential.credentialType === defaultCredentialTypes.basic) {
      const userId = getUserIdFromCredential(x.leaf.credential)
      if (!exclude.includes(userId)) {
        recipients.push(userId)
      }
    }
  }
  return recipients
}

export async function deriveGroupIdFromUserId(userId: string): Promise<Uint8Array> {
  // todo decide what to do here with kdf
  return new Uint8Array(await crypto.subtle.digest({ name: "SHA-256" }, new TextEncoder().encode(userId)));
}

