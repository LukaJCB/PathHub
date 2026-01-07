import { encode, decode } from "cbor-x"

interface JWKWithMeta extends JsonWebKey {
  alg: "EdDSA"
  use: "sig"
  kid: string
}

export interface AuthClient {
  startRegistration(body: { username: string; registrationRequest: string }): Promise<{ response: string }>

  finishRegistration(body: {
    username: string
    registrationRecord: string
    encryptedMasterKey: Uint8Array
    masterKeyNonce: Uint8Array
    encryptedRecoveryKey: Uint8Array
    recoveryKeyNonce: Uint8Array
    passwordEncryptedMasterKey: Uint8Array
    passwordMasterKeyNonce: Uint8Array
    salt: Uint8Array
    signingPublicKey: Uint8Array
  }): Promise<{ userId: string }>

  startLogin(body: { username: string; startLoginRequest: string }): Promise<{ response: string }>

  finishLogin(body: { username: string; finishLoginRequest: string }): Promise<{ token: string; manifest: string, encryptedMasterKey: Uint8Array, nonce: Uint8Array, salt: Uint8Array }>

  getUserInfo(userId: string[], token: string): Promise<{ username: string, key: Uint8Array, userid: string }[]>

  lookupUser(username: string, token: string): Promise<{ username: string, key: Uint8Array, userid: string } | undefined>

  getJwks(): Promise<JWKWithMeta>
}

export function createAuthenticationClient(baseUrl: string): AuthClient {
  const defaultHeaders = {
    "Content-Type": "application/cbor",
    Accept: "application/cbor",
  }

  async function postCBOR<TRequest, TResponse>(endpoint: string, body: TRequest): Promise<TResponse> {
    const res = await fetch(baseUrl + endpoint, {
      method: "POST",
      headers: defaultHeaders,
      body: encode(body) as BufferSource,
    })

    if (!res.ok) {
      throw new Error(`Unexpected status ${res.status} from ${endpoint}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    return decode(new Uint8Array(arrayBuffer)) as TResponse
  }

  async function postCBORWithAuth<TRequest, TResponse>(endpoint: string, body: TRequest, token: string): Promise<TResponse> {
    const res = await fetch(baseUrl + endpoint, {
      method: "POST",
      headers: {...defaultHeaders, Authorization: `Bearer ${token}` },
      body: encode(body) as BufferSource,
    })

    if (!res.ok) {
      throw new Error(`Unexpected status ${res.status} from ${endpoint}`)
    }

    const arrayBuffer = await res.arrayBuffer()
    return decode(new Uint8Array(arrayBuffer)) as TResponse
  }

  async function getJSON<TResponse>(endpoint: string): Promise<TResponse> {
    const res = await fetch(baseUrl + endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
    })
    if (!res.ok) throw new Error(`Failed to fetch ${endpoint}: ${res.status}`)
    return res.json() as Promise<TResponse>
  }

  return {
    startRegistration: (body) => postCBOR<typeof body, { response: string }>("/auth/startRegistration", body),

    finishRegistration: (body) => postCBOR<typeof body, { userId: string }>("/auth/finishRegistration", body),

    startLogin: (body) => postCBOR<typeof body, { response: string }>("/auth/startLogin", body),

    finishLogin: (body) => postCBOR<typeof body, { token: string; manifest: string, encryptedMasterKey: Uint8Array, nonce: Uint8Array, salt: Uint8Array }>("/auth/finishLogin", body),

    getUserInfo: (body, token) => postCBORWithAuth<typeof body,{ username: string, key: Uint8Array, userid: string }[]>(`/auth/userInfo`, body, token),

    lookupUser: async (username, token) => {
      const res = await fetch(baseUrl + "/auth/lookupUser", {
        method: "POST",
        headers: {...defaultHeaders, Authorization: `Bearer ${token}` },
        body: encode({ username }) as BufferSource,
      })

      if (res.status === 404) {
        return undefined
      }

      if (!res.ok) {
        throw new Error(`Unexpected status ${res.status} from /auth/lookupUser`)
      }

      const arrayBuffer = await res.arrayBuffer()
      return decode(new Uint8Array(arrayBuffer)) as { username: string, key: Uint8Array, userid: string }
    },

    getJwks: () => getJSON<JWKWithMeta>("/.well-known/jwks.json"),
  }
}
