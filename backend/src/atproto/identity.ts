// Resolve an atproto account from its own sources rather than from
// Bluesky's AppView (Decision 0017): the DID document gives the PDS and the
// claimed handle, the handle is checked back against the DID, and the PDS's
// `app.bsky.actor.profile` record gives the display name and avatar.

import { promises as dns } from 'dns';

export type FetchFn = typeof fetch;
export type ResolveTxtFn = (hostname: string) => Promise<string[][]>;

export interface Identity {
  did: string;
  /** The handle, or null when the DID document's claim doesn't verify. */
  handle: string | null;
  pdsEndpoint: string;
}

export interface Profile extends Identity {
  displayName: string | null;
  avatarCid: string | null;
}

export class IdentityError extends Error {
  constructor(did: string, reason: string) {
    super(`can't resolve ${did}: ${reason}`);
    this.name = 'IdentityError';
  }
}

export interface IdentityDeps {
  fetch?: FetchFn;
  resolveTxt?: ResolveTxtFn;
  plcDirectory?: string;
  timeoutMs?: number;
}

const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+(?:%3A[0-9]+)?)$/;
const HANDLE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;

export function isDid(s: string): boolean {
  return DID_RE.test(s);
}

export class IdentityResolver {
  private readonly fetch: FetchFn;
  private readonly resolveTxt: ResolveTxtFn;
  private readonly plcDirectory: string;
  private readonly timeoutMs: number;

  constructor(deps: IdentityDeps = {}) {
    this.fetch = deps.fetch ?? fetch;
    this.resolveTxt = deps.resolveTxt ?? ((h) => dns.resolveTxt(h));
    this.plcDirectory = (deps.plcDirectory ?? 'https://plc.directory').replace(/\/$/, '');
    this.timeoutMs = deps.timeoutMs ?? 10_000;
  }

  private get(url: string): Promise<Response> {
    return this.fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
  }

  private async getJson(url: string): Promise<unknown> {
    const res = await this.get(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.json();
  }

  async resolve(did: string): Promise<Identity> {
    if (!isDid(did)) throw new IdentityError(did, 'not a did:plc or did:web');
    const docUrl = did.startsWith('did:plc:')
      ? `${this.plcDirectory}/${did}`
      : `https://${decodeURIComponent(did.slice('did:web:'.length))}/.well-known/did.json`;

    let doc: any;
    try {
      doc = await this.getJson(docUrl);
    } catch (err) {
      throw new IdentityError(did, (err as Error).message);
    }
    if (doc?.id !== did) throw new IdentityError(did, 'DID document id mismatch');

    const pds = (Array.isArray(doc.service) ? doc.service : []).find(
      (s: any) => typeof s?.id === 'string' && s.id.endsWith('#atproto_pds')
        && s.type === 'AtprotoPersonalDataServer' && typeof s.serviceEndpoint === 'string',
    );
    if (!pds) throw new IdentityError(did, 'no atproto PDS in DID document');
    const pdsEndpoint = String(pds.serviceEndpoint).replace(/\/$/, '');
    if (!/^https?:\/\//.test(pdsEndpoint)) throw new IdentityError(did, 'PDS endpoint is not HTTP(S)');

    const claimed = (Array.isArray(doc.alsoKnownAs) ? doc.alsoKnownAs : [])
      .find((a: unknown) => typeof a === 'string' && a.startsWith('at://'));
    const handle = typeof claimed === 'string' ? claimed.slice('at://'.length).toLowerCase() : null;
    const verified = handle && HANDLE_RE.test(handle) && (await this.handleResolvesTo(handle, did));

    return { did, handle: verified ? handle : null, pdsEndpoint };
  }

  /** The handle's own DNS TXT record or well-known file must name the DID. */
  private async handleResolvesTo(handle: string, did: string): Promise<boolean> {
    try {
      const records = await this.resolveTxt(`_atproto.${handle}`);
      const dids = records.map((parts) => parts.join('')).filter((r) => r.startsWith('did='));
      if (dids.length > 0) return dids.length === 1 && dids[0] === `did=${did}`;
    } catch {
      // No TXT record; fall through to the well-known file.
    }
    try {
      const res = await this.get(`https://${handle}/.well-known/atproto-did`);
      return res.ok && (await res.text()).trim() === did;
    } catch {
      return false;
    }
  }

  /** Identity plus the profile record. A missing profile record is not an error. */
  async profile(did: string): Promise<Profile> {
    const identity = await this.resolve(did);
    const url = `${identity.pdsEndpoint}/xrpc/com.atproto.repo.getRecord`
      + `?repo=${encodeURIComponent(did)}&collection=app.bsky.actor.profile&rkey=self`;
    let value: any = null;
    try {
      value = ((await this.getJson(url)) as any)?.value ?? null;
    } catch {
      // No profile record (or the PDS refused): keep the identity alone.
    }
    const displayName = typeof value?.displayName === 'string' ? value.displayName.slice(0, 640) : null;
    const avatarLink = value?.avatar?.ref?.$link;
    return {
      ...identity,
      displayName,
      avatarCid: typeof avatarLink === 'string' ? avatarLink : null,
    };
  }
}
