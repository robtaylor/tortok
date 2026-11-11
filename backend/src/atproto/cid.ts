// The CID of an atproto blob: CIDv1, raw codec (0x55), SHA-256 multihash,
// multibase base32 ("b..."). Computing it lets the blob route check that a
// PDS returned exactly the bytes a CID names before serving them as
// immutable.

import { createHash } from 'crypto';

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

function base32(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** The blob CID atproto gives these bytes. */
export function blobCid(bytes: Uint8Array): string {
  const digest = createHash('sha256').update(bytes).digest();
  // version 1, raw codec, sha2-256, 32-byte digest
  return 'b' + base32(Buffer.concat([Buffer.from([0x01, 0x55, 0x12, 0x20]), digest]));
}

/** A string shaped like a base32 CIDv1 (no further check). */
export function isCid(s: string): boolean {
  return /^b[a-z2-7]{50,100}$/.test(s);
}
