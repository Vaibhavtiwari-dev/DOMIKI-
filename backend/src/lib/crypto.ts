import { ApiError } from './errors.js';

const encoder = new TextEncoder();
const PASSWORD_ITERATIONS = 600_000;
const PASSWORD_KEY_BYTES = 32;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const input = typeof value === 'string' ? encoder.encode(value) : value;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS },
    key,
    PASSWORD_KEY_BYTES * 8,
  );
  return `pbkdf2_sha256$${PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(bits))}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsText, saltText, expectedText] = encoded.split('$');
  const iterations = Number(iterationsText);
  if (
    algorithm !== 'pbkdf2_sha256' ||
    !Number.isSafeInteger(iterations) ||
    iterations < PASSWORD_ITERATIONS ||
    saltText === undefined ||
    expectedText === undefined
  ) {
    return false;
  }

  try {
    const salt = base64UrlToBytes(saltText);
    const saltBuffer = salt.buffer.slice(
      salt.byteOffset,
      salt.byteOffset + salt.byteLength,
    ) as ArrayBuffer;
    const expected = base64UrlToBytes(expectedText);
    const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
      'deriveBits',
    ]);
    const actual = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations },
        key,
        expected.byteLength * 8,
      ),
    );
    return constantTimeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index % left.byteLength] ?? 0) ^ (right[index % right.byteLength] ?? 0);
  }
  return difference === 0;
}

export async function hmacSha256(secret: string, value: string): Promise<string> {
  if (secret.length < 32) {
    throw new ApiError(500, 'SERVER_MISCONFIGURED', 'A signing secret is not configured safely.');
  }
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToBase64Url(
    new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))),
  );
}

export async function verifyHmac(
  secret: string,
  value: string,
  signature: string,
): Promise<boolean> {
  try {
    const expected = await hmacSha256(secret, value);
    return constantTimeEqual(encoder.encode(expected), encoder.encode(signature));
  } catch {
    return false;
  }
}

export function canonicalJson(value: unknown): string {
  const seen = new WeakSet();

  const normalize = (item: unknown): unknown => {
    if (item === null || typeof item !== 'object') return item;
    if (seen.has(item)) throw new ApiError(400, 'CYCLIC_JSON', 'Cyclic values are not supported.');
    seen.add(item);
    if (Array.isArray(item)) return item.map(normalize);
    return Object.fromEntries(
      Object.entries(item)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]),
    );
  };

  return JSON.stringify(normalize(value));
}

export function redactIp(ip: string | undefined): string | null {
  if (!ip) return null;
  if (ip.includes('.')) return `${ip.split('.').slice(0, 3).join('.')}.0/24`;
  return `${ip.split(':').slice(0, 4).join(':')}::/64`;
}
