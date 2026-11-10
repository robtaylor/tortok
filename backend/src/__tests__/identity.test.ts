import { IdentityError, IdentityResolver } from '../atproto/identity';

const DID = 'did:plc:teqobv6pqer5nw7roqrgi55v';
const PDS = 'https://pds.example.com';

function didDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: DID,
    alsoKnownAs: ['at://alice.example.com'],
    service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: `${PDS}/` }],
    ...overrides,
  };
}

/** A fetch stub serving fixed responses by URL prefix; anything else is a 404. */
function fakeFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (key === undefined) return new Response('not found', { status: 404 });
    const body = routes[key];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}

const noTxt = async () => { throw new Error('ENOTFOUND'); };

describe('IdentityResolver', () => {
  it('resolves the PDS and a handle verified by DNS', async () => {
    const r = new IdentityResolver({
      fetch: fakeFetch({ [`https://plc.directory/${DID}`]: didDoc() }),
      resolveTxt: async (h) => (h === '_atproto.alice.example.com' ? [[`did=${DID}`]] : []),
    });
    expect(await r.resolve(DID)).toEqual({ did: DID, handle: 'alice.example.com', pdsEndpoint: PDS });
  });

  it('verifies a handle through the well-known file when DNS has none', async () => {
    const r = new IdentityResolver({
      fetch: fakeFetch({
        [`https://plc.directory/${DID}`]: didDoc(),
        'https://alice.example.com/.well-known/atproto-did': `${DID}\n`,
      }),
      resolveTxt: noTxt,
    });
    expect((await r.resolve(DID)).handle).toBe('alice.example.com');
  });

  it("drops a handle that points at a different DID", async () => {
    const r = new IdentityResolver({
      fetch: fakeFetch({ [`https://plc.directory/${DID}`]: didDoc() }),
      resolveTxt: async () => [['did=did:plc:someoneelse']],
    });
    expect((await r.resolve(DID)).handle).toBeNull();
  });

  it('reads did:web documents from the host', async () => {
    const webDid = 'did:web:alice.example.com';
    const r = new IdentityResolver({
      fetch: fakeFetch({ 'https://alice.example.com/.well-known/did.json': didDoc({ id: webDid, alsoKnownAs: [] }) }),
      resolveTxt: noTxt,
    });
    expect(await r.resolve(webDid)).toEqual({ did: webDid, handle: null, pdsEndpoint: PDS });
  });

  it.each([
    ['a malformed DID', 'did:plc:short', {}],
    ['a document for another DID', DID, { [`https://plc.directory/${DID}`]: didDoc({ id: 'did:plc:other' }) }],
    ['a document with no PDS', DID, { [`https://plc.directory/${DID}`]: didDoc({ service: [] }) }],
    ['a missing document', DID, {}],
  ])('rejects %s', async (_label, did, routes) => {
    const r = new IdentityResolver({ fetch: fakeFetch(routes), resolveTxt: noTxt });
    await expect(r.resolve(did)).rejects.toThrow(IdentityError);
  });

  it('adds the profile record from the PDS', async () => {
    const r = new IdentityResolver({
      fetch: fakeFetch({
        [`https://plc.directory/${DID}`]: didDoc(),
        [`${PDS}/xrpc/com.atproto.repo.getRecord`]: {
          value: { displayName: 'Alice', avatar: { $type: 'blob', ref: { $link: 'bafkavatar' } } },
        },
      }),
      resolveTxt: noTxt,
    });
    expect(await r.profile(DID)).toMatchObject({ displayName: 'Alice', avatarCid: 'bafkavatar', pdsEndpoint: PDS });
  });

  it('returns the identity alone when there is no profile record', async () => {
    const r = new IdentityResolver({ fetch: fakeFetch({ [`https://plc.directory/${DID}`]: didDoc() }), resolveTxt: noTxt });
    expect(await r.profile(DID)).toMatchObject({ displayName: null, avatarCid: null });
  });
});
