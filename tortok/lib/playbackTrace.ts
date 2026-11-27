// What one stint as the active feed item measured about playback: how long
// the video took to start, and how it then played. The feed logs it as one
// line of JSON when the item stops being active (app/(tabs)/index.tsx), and
// scripts/playback-report.mjs reads those lines out of a device log.
//
// Times are Date.now() milliseconds, passed in, so this has no clock.

/** Begins every logged record; the report finds its lines by it. */
export const PLAYBACK_TAG = '[playback]';

/** How often the feed calls tick(), while the app is in the foreground. */
export const TICK_MS = 250;

/**
 * A step on the way to a playing video: a playback URL resolved (at once for
 * HLS; when the bridge serves the torrent, for a native post), the player was
 * ready, the poster gave way to the playing video, the first frame was drawn.
 */
export type PlaybackStep = 'url' | 'ready' | 'shown' | 'frame';

/** What a trace measured. */
export type PlaybackTimes = {
  /** When the item became active, epoch ms. */
  at: number;
  /** Milliseconds from becoming active to each step; null if never reached. */
  urlMs: number | null;
  readyMs: number | null;
  shownMs: number | null;
  frameMs: number | null;
  /** How long the item was active. */
  activeMs: number;
  /** Times playback stopped to buffer once it was showing, and for how long in all. */
  stalls: number;
  stallMs: number;
  /** The longest a tick came late: the JS thread or the main thread, which fires timers, was held up. */
  lagMs: number;
  /** The player's error, if it failed. */
  error: string | null;
};

/** The logged record: what the feed knows of the stint, and what its trace measured. */
export type PlaybackRecord = PlaybackTimes & {
  /** The version of this shape. */
  v: 1;
  /** The post's AT-URI. */
  post: string;
  kind: 'hls' | 'torrent';
  /** Media time that played, and how often it looped (lib/watchHistory.ts). */
  playedMs: number;
  loops: number;
};

export class PlaybackTrace {
  private readonly steps: Partial<Record<PlaybackStep, number>> = {};
  private stalls = 0;
  private stallMs = 0;
  private stalledAt: number | null = null;
  private lastTick: number;
  private lagMs = 0;
  private error: string | null = null;

  constructor(private readonly at: number) {
    this.lastTick = at;
  }

  /** A step was reached. Only the first time counts. */
  mark(step: PlaybackStep, now: number): void {
    this.steps[step] ??= now;
  }

  /** The player's status changed. Buffering once the video is showing is a stall. */
  status(status: string, now: number, error?: string): void {
    if (status === 'readyToPlay') this.mark('ready', now);
    if (status === 'error') this.error = error ?? 'unknown error';
    if (status !== 'loading') this.endStall(now);
    else if (this.steps.shown !== undefined && this.stalledAt === null) {
      this.stalls++;
      this.stalledAt = now;
    }
  }

  /** Called every TICK_MS. How late a call comes is how long the app was held up. */
  tick(now: number): void {
    this.lagMs = Math.max(this.lagMs, now - this.lastTick - TICK_MS);
    this.lastTick = now;
  }

  /** The item stopped being active. A stall still going counts up to now. */
  end(now: number): PlaybackTimes {
    this.endStall(now);
    const since = (step: PlaybackStep) => {
      const t = this.steps[step];
      return t === undefined ? null : t - this.at;
    };
    return {
      at: this.at,
      urlMs: since('url'),
      readyMs: since('ready'),
      shownMs: since('shown'),
      frameMs: since('frame'),
      activeMs: now - this.at,
      stalls: this.stalls,
      stallMs: this.stallMs,
      lagMs: this.lagMs,
      error: this.error,
    };
  }

  private endStall(now: number): void {
    if (this.stalledAt === null) return;
    this.stallMs += now - this.stalledAt;
    this.stalledAt = null;
  }
}
