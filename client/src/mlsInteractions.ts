import { ClientState, bytesToBase64 } from "ts-mls";

//todo use array instead of individual strings
export function recipientsFromMlsState(exclude: string[], clientState: ClientState): string[] {
  const recipients = []
  for (const x of clientState.ratchetTree) {
    if (x?.nodeType === 'leaf' && x.leaf.credential.credentialType === 'basic') {
      const userId = bytesToBase64(x.leaf.credential.identity)
      if (!exclude.includes(userId)) {
        recipients.push(userId)
      }
    }
  }
  return recipients
}

export async function deriveGroupIdFromUserId(userId: string): Promise<Uint8Array> {
  // todo decide what to do here
  return new Uint8Array(await crypto.subtle.digest({ name: "SHA-256" }, new TextEncoder().encode(userId)));
}

