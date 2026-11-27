// Unit tests for the playback trace: the steps to a playing video, stalls,
// and the app's worst hold-up. Run with `npm test`.

import { PlaybackTrace, TICK_MS } from './playbackTrace';

describe('PlaybackTrace', () => {
  test('times each step from when the item became active; buffering before the video shows is no stall', () => {
    const t = new PlaybackTrace(1_000);
    t.mark('url', 1_010);
    t.status('loading', 1_020);
    t.status('readyToPlay', 1_400);
    t.mark('frame', 1_450);
    t.mark('shown', 1_480);
    expect(t.end(6_000)).toEqual({
      at: 1_000,
      urlMs: 10,
      readyMs: 400,
      shownMs: 480,
      frameMs: 450,
      activeMs: 5_000,
      stalls: 0,
      stallMs: 0,
      lagMs: 0,
      error: null,
    });
  });

  test('a step counts the first time only', () => {
    const t = new PlaybackTrace(0);
    t.status('readyToPlay', 300);
    t.status('loading', 400);
    t.status('readyToPlay', 900);
    t.mark('frame', 350);
    t.mark('frame', 950);
    expect(t.end(1_000)).toMatchObject({ readyMs: 300, frameMs: 350 });
  });

  test('a video left before it started has no later steps', () => {
    const t = new PlaybackTrace(0);
    t.mark('url', 5);
    t.status('loading', 10);
    expect(t.end(700)).toMatchObject({
      urlMs: 5, readyMs: null, shownMs: null, frameMs: null, activeMs: 700, stalls: 0,
    });
  });

  test('buffering once the video shows is a stall, for as long as it lasts', () => {
    const t = new PlaybackTrace(0);
    t.status('readyToPlay', 500);
    t.mark('shown', 520);
    t.status('loading', 3_000);
    t.status('loading', 3_100); // repeated: still the same stall
    t.status('readyToPlay', 3_800);
    t.status('loading', 6_000);
    t.status('readyToPlay', 6_250);
    expect(t.end(9_000)).toMatchObject({ stalls: 2, stallMs: 1_050 });
  });

  test('a stall still going when the item is left counts up to then', () => {
    const t = new PlaybackTrace(0);
    t.mark('shown', 500);
    t.status('loading', 2_000);
    expect(t.end(5_000)).toMatchObject({ stalls: 1, stallMs: 3_000 });
  });

  test("keeps the player's error, which ends a stall", () => {
    const t = new PlaybackTrace(0);
    t.mark('shown', 500);
    t.status('loading', 2_000);
    t.status('error', 2_400, 'Source error');
    expect(t.end(5_000)).toMatchObject({ stalls: 1, stallMs: 400, error: 'Source error' });
  });

  test('reports the longest a tick came late', () => {
    const t = new PlaybackTrace(0);
    t.tick(TICK_MS);            // on time
    t.tick(2 * TICK_MS + 40);   // 40 ms late
    t.tick(3 * TICK_MS + 1_240); // 1,200 ms after it was due
    t.tick(4 * TICK_MS + 1_240); // on time again
    expect(t.end(10_000).lagMs).toBe(1_200);
  });
});
