// Unit tests for the local watch history: how a session reads the player's
// time updates, and the bounded event log. Run with `npm test`.

jest.mock('react-native-mmkv'); // __mocks__/react-native-mmkv.ts

import { isSkip, MAX_EVENTS, recordView, statsFor, viewEvents, WatchSession } from './watchHistory';

const data = (jest.requireMock('react-native-mmkv') as { __data: Map<string, unknown> }).__data;
beforeEach(() => data.clear());

/** Feed a session time updates every 100 ms from `from` to `to` seconds. */
function play(s: WatchSession, from: number, to: number, duration: number) {
  for (let t = from; t <= to + 1e-9; t += 0.1) s.onTime(Math.round(t * 10) / 10, duration);
}

describe('WatchSession', () => {
  test('a short look is a skip', () => {
    const s = new WatchSession();
    play(s, 0, 1.5, 20);
    const r = s.end();
    expect(r).toEqual({ watchedMs: 1500, loops: 0, completed: false, durationS: 20 });
    expect(isSkip(r)).toBe(true);
  });

  test('watching to the end completes; each wrap is a loop', () => {
    const s = new WatchSession();
    play(s, 0, 20, 20);
    expect(s.end()).toMatchObject({ completed: true, loops: 0 });
    play(s, 0, 20, 20);
    play(s, 0, 3, 20);
    const r = s.end();
    expect(r).toMatchObject({ loops: 2, completed: true, watchedMs: 43000 });
    expect(isSkip(r)).toBe(false);
  });

  test('seeks and pauses add no watch time', () => {
    const s = new WatchSession();
    play(s, 0, 5, 20);
    s.onTime(10, 20); // seek forward
    s.onTime(10, 20); // paused
    s.onTime(10, 20);
    play(s, 10, 11, 20);
    s.onTime(2, 20); // seek back from mid-clip: not a loop
    expect(s.end()).toMatchObject({ watchedMs: 6000, loops: 0, completed: false });
  });

  test('nothing played is an empty record, with no duration yet', () => {
    expect(new WatchSession().end()).toEqual({ watchedMs: 0, loops: 0, completed: false, durationS: null });
  });
});

describe('the event log', () => {
  const at = 'at://did:plc:a/app.tortok.video.post/1';
  const view = (watchedMs: number, completed = false, loops = 0) => ({ watchedMs, loops, completed, durationS: 20 });

  test('appends each view, with its time and the post’s hashtags', () => {
    recordView(at, ['#cats'], view(1000), 100);
    recordView(at, ['#cats'], view(25000, true, 1), 200);
    expect(viewEvents()).toEqual([
      { post: at, at: 100, hashtags: ['#cats'], ...view(1000) },
      { post: at, at: 200, hashtags: ['#cats'], ...view(25000, true, 1) },
    ]);
    expect(statsFor(at)).toEqual({ views: 2, watchedMs: 26000, completions: 1, loops: 1, skips: 1, lastWatchedAt: 200 });
    expect(statsFor('at://other')).toBeNull();
  });

  test('a view with no playback is not recorded', () => {
    recordView(at, [], view(0));
    expect(viewEvents()).toEqual([]);
  });

  test('past MAX_EVENTS, each new view drops the oldest', () => {
    for (let i = 0; i < MAX_EVENTS + 3; i++) recordView(`p${i}`, [], view(10), i);
    const events = viewEvents();
    expect(events).toHaveLength(MAX_EVENTS);
    expect(events[0].post).toBe('p3');
    expect(events.at(-1)!.post).toBe(`p${MAX_EVENTS + 2}`);
  });
});
