import { readFile } from 'node:fs/promises';
import { connect } from 'node:http2';
import { Logger } from '@nestjs/common';
import { AppleWalletConfig } from './apple-wallet.config.js';

export const APNS_CLIENT = Symbol('APNS_CLIENT');

/**
 * Sends the PassKit "your pass changed" push: an empty JSON payload to the
 * device's push token with the pass type identifier as topic. Interface so
 * tests record pushes instead of talking to Apple.
 */
export interface ApnsClient {
  pushPassUpdate(pushToken: string, topic: string): Promise<void>;
}

const APNS_HOST = 'https://api.push.apple.com';

/**
 * Real APNs client over node:http2 with certificate-based auth — the Pass
 * Type ID certificate doubles as the APNs client certificate for its passes.
 * One short-lived session per push is plenty at MVP volume.
 */
export class Http2ApnsClient implements ApnsClient {
  constructor(private readonly config: AppleWalletConfig) {}

  async pushPassUpdate(pushToken: string, topic: string): Promise<void> {
    const pem = await readFile(this.config.certPath);
    const session = connect(APNS_HOST, {
      cert: pem,
      key: pem,
      passphrase: this.config.certPassword || undefined,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        session.on('error', reject);
        const req = session.request({
          ':method': 'POST',
          ':path': `/3/device/${pushToken}`,
          'apns-topic': topic,
          'content-type': 'application/json',
        });
        let status = 0;
        let body = '';
        req.setEncoding('utf8');
        req.on('response', (headers) => {
          status = Number(headers[':status'] ?? 0);
        });
        req.on('data', (c: string) => (body += c));
        req.on('end', () =>
          status === 200 ? resolve() : reject(new Error(`APNs ${status}: ${body}`)),
        );
        req.on('error', reject);
        // PassKit update pushes carry an empty JSON dictionary as payload.
        req.end('{}');
      });
    } finally {
      session.close();
    }
  }
}

/** Bound when Apple credentials are absent: pushes are skipped, not queued. */
export class NoopApnsClient implements ApnsClient {
  private readonly logger = new Logger(NoopApnsClient.name);

  async pushPassUpdate(pushToken: string, topic: string): Promise<void> {
    this.logger.debug(`apple wallet not configured; skipping push to ${topic}/${pushToken}`);
  }
}
