// Unit tests for the bridge's read-ahead: which bytes it reads, and that it
// settles however the stream ends. The HTTP side needs a device's sockets and
// is covered by the end-to-end tests. Run with `npm test`.

jest.mock('react-native-tcp-socket', () => ({
  __esModule: true,
  default: {
    createServer: () => ({
      listen: (_options: unknown, listening: () => void) => listening(),
      address: () => ({ port: 4321 }),
      close: () => {},
    }),
  },
}));

import { readAhead, registerTorrent } from './bridge.native';
import type { Torrent, TorrentFile } from './types';

const INFO_HASH = 'a'.repeat(40);

type Listener = (arg?: unknown) => void;

/** A torrent file whose one read stream the test drives by hand. */
function fakeFile(length: number) {
  const listeners: Record<string, Listener> = {};
  const opened: { start?: number; end?: number }[] = [];
  let destroyed = false;
  const emit = (event: string, arg?: unknown) => listeners[event]?.(arg);
  const file: TorrentFile = {
    name: 'clip.mp4',
    path: 'clip.mp4',
    length,
    createReadStream: (opts) => {
      opened.push(opts ?? {});
      const stream = {
        on: (event: string, cb: Listener) => {
          listeners[event] = cb;
          return stream;
        },
        // As streamx does: destroying a stream closes it, with no error.
        destroy: () => {
          destroyed = true;
          emit('close');
        },
      };
      return stream;
    },
  };
  return { file, opened, emit, isDestroyed: () => destroyed };
}

/** Register a one-file torrent and return its bridge URL with the fake file's controls. */
async function registered(length = 1_000_000) {
  const fake = fakeFile(length);
  const url = await registerTorrent({ infoHash: INFO_HASH, files: [fake.file] } as unknown as Torrent);
  return { url, ...fake };
}

const bytes = (n: number) => ({ length: n });

beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

test('the bridge URL names the torrent and its file on this device', async () => {
  const { url } = await registered();
  expect(url).toBe(`http://127.0.0.1:4321/${INFO_HASH}/clip.mp4`);
});

test('reads the first bytes of the file and resolves with how many came', async () => {
  const { url, opened, emit } = await registered();
  const read = readAhead(url, 4096, new AbortController().signal);
  expect(opened).toEqual([{ start: 0, end: 4095 }]);
  emit('data', bytes(3000));
  emit('data', bytes(1096));
  emit('end');
  emit('close');
  await expect(read).resolves.toBe(4096);
});

test('reads no further than the file goes', async () => {
  const { url, opened, emit } = await registered(100);
  const read = readAhead(url, 4096, new AbortController().signal);
  expect(opened).toEqual([{ start: 0, end: 99 }]);
  emit('data', bytes(100));
  emit('close');
  await expect(read).resolves.toBe(100);
});

test('rejects a URL nothing is registered at', async () => {
  await registered();
  await expect(readAhead(`http://127.0.0.1:4321/${'b'.repeat(40)}/clip.mp4`, 4096, new AbortController().signal))
    .rejects.toThrow('nothing registered');
});

test('an abort destroys the stream and rejects', async () => {
  const { url, emit, isDestroyed } = await registered();
  const abort = new AbortController();
  const read = readAhead(url, 4096, abort.signal);
  emit('data', bytes(1000));
  abort.abort();
  expect(isDestroyed()).toBe(true);
  await expect(read).rejects.toThrow('aborted');
});

test('a signal already aborted opens no stream', async () => {
  const { url, opened } = await registered();
  const abort = new AbortController();
  abort.abort();
  await expect(readAhead(url, 4096, abort.signal)).rejects.toThrow('aborted');
  expect(opened).toEqual([]);
});

test('a stream closed under it, as when the torrent is removed, resolves with what was read', async () => {
  const { url, emit } = await registered();
  const read = readAhead(url, 4096, new AbortController().signal);
  emit('data', bytes(1000));
  emit('close');
  await expect(read).resolves.toBe(1000);
});

test("rejects with the stream's error", async () => {
  const { url, emit } = await registered();
  const read = readAhead(url, 4096, new AbortController().signal);
  emit('error', new Error('piece failed its hash'));
  emit('close');
  await expect(read).rejects.toThrow('piece failed its hash');
});
