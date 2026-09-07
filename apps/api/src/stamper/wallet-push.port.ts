// Outbound port for wallet pass updates. Every stamper mutation (stamp,
// redeem) ends by calling passChanged so the customer's wallet pass refreshes.
// StamperModule binds a no-op default; T8 (Apple APNs) and T9 (Google Wallet)
// replace the WALLET_PUSH provider with real push implementations.
export const WALLET_PUSH = Symbol('WALLET_PUSH');

export interface WalletPushPort {
  passChanged(passId: string): Promise<void>;
}

export class NoopWalletPush implements WalletPushPort {
  async passChanged(_passId: string): Promise<void> {
    // Intentionally empty: wallet push is wired in by T8/T9.
  }
}
