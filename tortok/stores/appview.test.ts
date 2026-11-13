// Unit tests for the AppView store: the build default, URL parsing, the
// feed check before a URL is saved, persistence and reset. Run with
// `npm test` from `tortok/`.

jest.mock('react-native-mmkv'); // __mocks__/react-native-mmkv.ts
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { hostUri: '192.168.1.5:8081' } } }));

const URL_KEY = 'appviewUrl';
const OTHER = 'https://appview.example.com';

type Store = typeof import('./appview');
type Build = { dev?: boolean; e2e?: boolean; apiUrl?: string };

/** The settings MMKV holds; set before load() to simulate a saved choice. */
let saved: Map<string, string>;

/** Load the store fresh, as a given build would. */
function load({ dev = false, e2e = false, apiUrl }: Build = {}, savedUrl?: string): Store {
  jest.resetModules();
  (globalThis as { __DEV__?: boolean }).__DEV__ = dev;
  process.env.EXPO_PUBLIC_E2E = e2e ? '1' : '';
  if (apiUrl) process.env.EXPO_PUBLIC_API_URL = apiUrl;
  else delete process.env.EXPO_PUBLIC_API_URL;
  saved = (jest.requireMock('react-native-mmkv') as { __data: Map<string, string> }).__data;
  saved.clear();
  if (savedUrl) saved.set(URL_KEY, savedUrl);
  return require('./appview') as Store;
}

const feed = (body: unknown, status = 200) =>
  jest.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const servesFeed = () => feed({ videos: [], nextCursor: null, hasMore: false });

describe('the build default', () => {
  it("is tortok's AppView in a release build", () => {
    const m = load();
    expect(m.DEFAULT_APPVIEW_URL).toBe(m.TORTOK_APPVIEW_URL);
    expect(m.useAppViewStore.getState().url).toBe(m.TORTOK_APPVIEW_URL);
  });

  it('is the dev machine on 8080 in development', () => {
    expect(load({ dev: true }).DEFAULT_APPVIEW_URL).toBe('http://192.168.1.5:8080');
  });

  it("is EXPO_PUBLIC_API_URL's origin when the build sets it", () => {
    expect(load({ apiUrl: 'http://localhost:8080/' }).DEFAULT_APPVIEW_URL).toBe('http://localhost:8080');
  });

  it('gives way to a saved choice', () => {
    expect(load({}, OTHER).useAppViewStore.getState().url).toBe(OTHER);
  });
});

describe('parseAppViewUrl', () => {
  it.each([
    ['https://appview.example.com', OTHER],
    ['  https://appview.example.com/  ', OTHER],
    ['https://appview.example.com:8443', 'https://appview.example.com:8443'],
  ])('accepts %p', (input, expected) => {
    expect(load().parseAppViewUrl(input)).toBe(expected);
  });

  it.each([
    ['appview.example.com', 'full URL'],
    ['ftp://appview.example.com', 'https'],
    ['https://appview.example.com/videos', 'no path'],
    ['https://appview.example.com/?x=1', 'no path'],
  ])('rejects %p', (input, message) => {
    const m = load();
    expect(() => m.parseAppViewUrl(input)).toThrow(m.AppViewUrlError);
    expect(() => m.parseAppViewUrl(input)).toThrow(message);
  });

  it('takes http only in development and e2e builds, or for the build default', () => {
    expect(() => load().parseAppViewUrl('http://192.168.1.9:8080')).toThrow('https');
    expect(load({ dev: true }).parseAppViewUrl('http://192.168.1.9:8080')).toBe('http://192.168.1.9:8080');
    expect(load({ e2e: true }).parseAppViewUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(load({ apiUrl: 'http://localhost:8080' }).parseAppViewUrl('http://localhost:8080')).toBe('http://localhost:8080');
  });
});

describe('setUrl', () => {
  it('checks the AppView serves a feed, then saves it and switches', async () => {
    const m = load();
    const fetchImpl = servesFeed();

    await expect(m.useAppViewStore.getState().setUrl(`${OTHER}/`, fetchImpl)).resolves.toBe(OTHER);

    expect(fetchImpl).toHaveBeenCalledWith(`${OTHER}/videos/feed?limit=1`);
    expect(m.useAppViewStore.getState().url).toBe(OTHER);
    expect(saved.get(URL_KEY)).toBe(OTHER);
  });

  it.each([
    ['an error status', feed({ videos: [] }, 502), 'isn’t answering as a tortok AppView'],
    ['a server with no feed', feed({ status: 'healthy' }), 'isn’t answering as a tortok AppView'],
    ['an unreachable server', (async () => { throw new TypeError('Network request failed'); }) as typeof fetch, 'Couldn’t reach'],
  ])('refuses %s and keeps the current AppView', async (_, fetchImpl, message) => {
    const m = load();
    await expect(m.useAppViewStore.getState().setUrl(OTHER, fetchImpl)).rejects.toThrow(message);
    expect(m.useAppViewStore.getState().url).toBe(m.TORTOK_APPVIEW_URL);
    expect(saved.has(URL_KEY)).toBe(false);
  });

  it('treats saving the default as going back to it', async () => {
    const m = load({}, OTHER);
    await m.useAppViewStore.getState().setUrl(m.TORTOK_APPVIEW_URL, servesFeed());
    expect(m.useAppViewStore.getState().url).toBe(m.TORTOK_APPVIEW_URL);
    expect(saved.has(URL_KEY)).toBe(false);
  });
});

it('reset forgets the saved AppView', () => {
  const m = load({}, OTHER);
  m.useAppViewStore.getState().reset();
  expect(m.useAppViewStore.getState().url).toBe(m.TORTOK_APPVIEW_URL);
  expect(saved.has(URL_KEY)).toBe(false);
});
