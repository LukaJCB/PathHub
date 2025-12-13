import {
  AuthenticationService,
  ClientConfig,
  defaultKeyPackageEqualityConfig,
  defaultKeyRetentionConfig,
  defaultPaddingConfig,
} from "ts-mls"

export const authService: AuthenticationService = {
  async validateCredential(credential, signaturePublicKey) {
    return true //todo
  },
}

export const clientConfig: ClientConfig = {
  authService,
  keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
  keyRetentionConfig: defaultKeyRetentionConfig,
  lifetimeConfig: {
    maximumTotalLifetime: 2628000n,
    validateLifetimeOnReceive: true,
  },
  paddingConfig: defaultPaddingConfig,
}
