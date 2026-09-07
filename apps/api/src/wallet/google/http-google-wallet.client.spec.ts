import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { HttpGoogleWalletClient } from './http-google-wallet.client.js';

// Unit tests for the real client: RS256 signing and the OAuth2 JWT-bearer
// flow are verified against a locally generated RSA key and a fake fetch —
// no Google credentials, no network.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function decodeJwt(jwt: string, publicKeyPem: string) {
  const [header, payload, signature] = jwt.split('.');
  const verified = createVerify('RSA-SHA256')
    .update(`${header}.${payload}`)
    .verify(publicKeyPem, signature!, 'base64url');
  return {
    verified,
    header: JSON.parse(Buffer.from(header!, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(payload!, 'base64url').toString()),
  };
}

interface RecordedCall {
  url: string;
  init?: RequestInit;
}

function jsonResponse(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('HttpGoogleWalletClient', () => {
  let publicKeyPem: string;
  let credentialsPath: string;

  beforeAll(async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    publicKeyPem = publicKey;
    const dir = await mkdtemp(join(tmpdir(), 'gwallet-'));
    credentialsPath = join(dir, 'service-account.json');
    await writeFile(
      credentialsPath,
      JSON.stringify({ client_email: 'svc@test.iam.gserviceaccount.com', private_key: privateKey }),
    );
  });

  function makeClient(responses: Response[]) {
    const calls: RecordedCall[] = [];
    const client = new HttpGoogleWalletClient(
      { issuerId: '3388000000012345678', credentialsPath },
      async (url, init) => {
        calls.push({ url, init });
        const next = responses.shift();
        if (!next) throw new Error(`unexpected fetch to ${url}`);
        return next;
      },
    );
    return { client, calls };
  }

  it('signs a save JWT (RS256) with the standard savetowallet envelope', async () => {
    const { client } = makeClient([]);
    const jwt = await client.signSaveJwt({
      payload: { loyaltyObjects: [{ id: 'issuer.pass_1', classId: 'issuer.cafe_1' }] },
      origins: [],
    });
    const { verified, header, claims } = decodeJwt(jwt, publicKeyPem);
    expect(verified).toBe(true);
    expect(header).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(claims).toMatchObject({
      iss: 'svc@test.iam.gserviceaccount.com',
      aud: 'google',
      typ: 'savetowallet',
      payload: { loyaltyObjects: [{ id: 'issuer.pass_1', classId: 'issuer.cafe_1' }] },
      origins: [],
    });
    expect(claims.iat).toEqual(expect.any(Number));
  });

  it('fetches an OAuth token with a signed assertion, then calls the API with it', async () => {
    const { client, calls } = makeClient([
      jsonResponse({ access_token: 'token-abc', expires_in: 3600 }),
      jsonResponse({ id: 'issuer.cafe_x' }),
    ]);
    const cls = await client.getClass('issuer.cafe_x');
    expect(cls).toEqual({ id: 'issuer.cafe_x' });

    // First call: token endpoint, JWT-bearer grant with a verifiable assertion.
    expect(calls[0]!.url).toBe(TOKEN_URL);
    const form = new URLSearchParams(calls[0]!.init!.body as string);
    expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = decodeJwt(form.get('assertion')!, publicKeyPem);
    expect(assertion.verified).toBe(true);
    expect(assertion.claims).toMatchObject({
      iss: 'svc@test.iam.gserviceaccount.com',
      scope: 'https://www.googleapis.com/auth/wallet_object.issuer',
      aud: TOKEN_URL,
    });

    // Second call: the API request, authorized with the fetched token.
    expect(calls[1]!.url).toBe(
      'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass/issuer.cafe_x',
    );
    const headers = calls[1]!.init!.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer token-abc');
  });

  it('reuses the cached token across requests and maps 404 to null', async () => {
    const { client, calls } = makeClient([
      jsonResponse({ access_token: 'token-once', expires_in: 3600 }),
      jsonResponse({ error: 'not found' }, 404),
      jsonResponse({ id: 'issuer.pass_y' }),
    ]);
    expect(await client.getObject('issuer.pass_missing')).toBeNull();
    expect(await client.getObject('issuer.pass_y')).toEqual({ id: 'issuer.pass_y' });
    // Only one token fetch for both API calls.
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1);
  });

  it('sends JSON bodies for insert and patch, and throws on API errors', async () => {
    const { client, calls } = makeClient([
      jsonResponse({ access_token: 't', expires_in: 3600 }),
      jsonResponse({}),
      jsonResponse({ error: 'quota' }, 429),
    ]);
    await client.patchObject('issuer.pass_z', { state: 'ACTIVE' });
    const patchCall = calls[1]!;
    expect(patchCall.init!.method).toBe('PATCH');
    expect(JSON.parse(patchCall.init!.body as string)).toEqual({ state: 'ACTIVE' });

    await expect(
      client.insertClass({
        id: 'issuer.cafe_z',
        issuerName: 'Z',
        programName: 'Z Card',
        reviewStatus: 'UNDER_REVIEW',
      }),
    ).rejects.toThrow(/429/);
  });
});
