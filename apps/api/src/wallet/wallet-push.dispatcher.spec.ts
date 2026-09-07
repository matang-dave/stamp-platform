import { describe, expect, it, vi } from 'vitest';
import type { ApplePassPush } from './apple/apple-pass-push.js';
import type { GoogleWalletPush } from './google/google-wallet.push.js';
import { WalletPushDispatcher } from './wallet-push.dispatcher.js';

describe('WalletPushDispatcher', () => {
  it('fans a pass change out to both platform implementations', async () => {
    const google = { passChanged: vi.fn().mockResolvedValue(undefined) };
    const apple = { passChanged: vi.fn().mockResolvedValue(undefined) };
    const dispatcher = new WalletPushDispatcher(
      google as unknown as GoogleWalletPush,
      apple as unknown as ApplePassPush,
    );

    await dispatcher.passChanged('pass-123');

    expect(google.passChanged).toHaveBeenCalledExactlyOnceWith('pass-123');
    expect(apple.passChanged).toHaveBeenCalledExactlyOnceWith('pass-123');
  });
});
