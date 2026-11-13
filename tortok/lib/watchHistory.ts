// What the user watched, kept on this device only (plan 2.5D step 20;
// open-problems/feed-ranking.md constraint 1: behaviour never leaves the
// phone). Nothing reads it yet: it exists so that when ranking arrives there
// is history to rank on.
//
// It is a log of view events, not running totals, because what ranking is
// leaning towards needs each view's time and the post's features: modes
// (what you watch in bed vs. travelling), explanations ("you skipped this
// creator twice") and recipes tuned on past views. Totals derive from the
// log (statsFor); the log can't be rebuilt from totals.
//
// WatchSession turns one stint on a post (from when it became the active
// item to when it stopped being) into a WatchRecord, from the player's time
// updates alone, so it is pure and testable; recordView appends it.

import { MMKV } from 'react-native-mmkv';

export interface WatchRecord {
  /** Playback time actually watched, summed across loops; pauses and seeks don't count. */
  watchedMs: number;
  /** Times playback wrapped from the end back to the start. */
  loops: number;
  /** Reached the end (95%) at least once. */
  completed: boolean;
  /** The video's length in seconds, if the player knew it. */
  durationS: number | null;
}

/** One view, as stored. */
export interface ViewEvent extends WatchRecord {
  /** The post's AT-URI; its DID is the author. */
  post: string;
  /** Epoch ms the view ended. */
  at: number;
  hashtags: string[];
}

export interface WatchStats {
  views: number;
  watchedMs: number;
  completions: number;
  loops: number;
  skips: number;
  lastWatchedAt: number;
}

/** Leaving a post within this much watched time, without finishing it, is a skip. */
export const SKIP_MS = 2_000;
/** Events kept; each new one past this drops the oldest. */
export const MAX_EVENTS = 20_000;

export const isSkip = (r: WatchRecord) => !r.completed && r.watchedMs < SKIP_MS;

export class WatchSession {
  private last: number | null = null;
  private watchedS = 0;
  private loops = 0;
  private completed = false;
  private duration = 0;

  /** A player time update: position and duration, in seconds. */
  onTime(currentTime: number, duration: number): void {
    if (duration > 0) this.duration = duration;
    if (this.last !== null) {
      const delta = currentTime - this.last;
      // Small forward steps are playback. A big step back from near the end
      // is the loop wrapping; any other jump is a seek and isn't counted.
      if (delta > 0 && delta < 1) this.watchedS += delta;
      else if (delta < 0 && this.duration > 0 && this.last >= this.duration * 0.8 && currentTime < this.duration * 0.2) {
        this.loops++;
        this.completed = true;
      }
    }
    if (this.duration > 0 && currentTime >= this.duration * 0.95) this.completed = true;
    this.last = currentTime;
  }

  end(): WatchRecord {
    return {
      watchedMs: Math.round(this.watchedS * 1000),
      loops: this.loops,
      completed: this.completed,
      durationS: this.duration > 0 ? this.duration : null,
    };
  }
}

// Events are keys `e<seq>`; `seq` is the next number. Dropping the oldest is
// one delete, whatever the log's size.
const store = new MMKV({ id: 'tortok-watch-history' });
const SEQ = 'seq';

/** Append one view. A view with no playback at all isn't recorded. */
export function recordView(post: string, hashtags: string[], r: WatchRecord, now = Date.now()): void {
  if (r.watchedMs === 0 && !r.completed) return;
  const seq = store.getNumber(SEQ) ?? 0;
  store.set(`e${seq}`, JSON.stringify({ post, at: now, hashtags, ...r } satisfies ViewEvent));
  store.set(SEQ, seq + 1);
  if (seq >= MAX_EVENTS) store.delete(`e${seq - MAX_EVENTS}`);
}

/** Every stored view, oldest first. */
export function viewEvents(): ViewEvent[] {
  const end = store.getNumber(SEQ) ?? 0;
  const out: ViewEvent[] = [];
  for (let i = Math.max(0, end - MAX_EVENTS); i < end; i++) {
    const raw = store.getString(`e${i}`);
    if (raw) out.push(JSON.parse(raw) as ViewEvent);
  }
  return out;
}

/** One post's totals, derived from the log. */
export function statsFor(post: string, events = viewEvents()): WatchStats | null {
  const mine = events.filter((e) => e.post === post);
  if (mine.length === 0) return null;
  return {
    views: mine.length,
    watchedMs: mine.reduce((n, e) => n + e.watchedMs, 0),
    completions: mine.filter((e) => e.completed).length,
    loops: mine.reduce((n, e) => n + e.loops, 0),
    skips: mine.filter(isSkip).length,
    lastWatchedAt: Math.max(...mine.map((e) => e.at)),
  };
}
