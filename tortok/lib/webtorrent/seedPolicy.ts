// Client-side seeding policy (ADR-009).
//
// Holds recently-watched torrents alive via the existing refcount system
// in client.ts. Each held torrent has refCount bumped by 1; when the
// policy evicts (TTL, budget, conditions), it releases that hold.

import { Platform } from 'react-native';
import { requestUrl, release } from './client';

// ---------------------------------------------------------------------------
// Constants (ADR-009 starting numbers)
// ---------------------------------------------------------------------------

const isMobile = Platform.OS === 'ios' || Platform.OS === 'android';

const MAX_SEEDS = isMobile ? 5 : Infinity;
const SEED_TTL_MS = 30 * 60 * 1000; // 30 minutes
const BYTE_BUDGET = isMobile ? 150 * 1024 * 1024 : 500 * 1024 * 1024;
const EVICTION_INTERVAL_MS = 60_000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type SeedEntry = {
  magnetLink: string;
  torrentFileUrl: string | null;
  watchedAt: number;
  bytesEstimate: number;
  holding: boolean;
};

const seedQueue: SeedEntry[] = []; // most-recent-first
let evictionTimer: ReturnType<typeof setInterval> | null = null;
let paused = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Notify the policy that a video was watched. Acquires a seed hold
 * (bumps refcount) and adds to the queue. Evicts oldest entries if
 * over budget.
 */
export function notifyWatched(
  magnetLink: string | null,
  torrentFileUrl: string | null,
  bytesEstimate: number,
): void {
  if (!magnetLink) return;

  // Already in queue — move to front and refresh timestamp.
  const idx = seedQueue.findIndex((e) => e.magnetLink === magnetLink);
  if (idx >= 0) {
    const entry = seedQueue.splice(idx, 1)[0];
    entry.watchedAt = Date.now();
    seedQueue.unshift(entry);
    return;
  }

  // New entry — acquire hold before adding.
  const entry: SeedEntry = {
    magnetLink,
    torrentFileUrl,
    watchedAt: Date.now(),
    bytesEstimate,
    holding: false,
  };

  if (!paused) {
    acquireHold(entry);
  }

  seedQueue.unshift(entry);
  evict();
  ensureTimer();
}

/** Release all holds and clear the queue. Call on app background. */
export function stopAll(): void {
  for (const entry of seedQueue) {
    releaseHold(entry);
  }
  seedQueue.length = 0;
  stopTimer();
  paused = false;
}

/** Release holds but keep the queue (conditions unfavorable). */
export function pauseSeeding(): void {
  if (paused) return;
  paused = true;
  for (const entry of seedQueue) {
    releaseHold(entry);
  }
}

/** Re-acquire holds for entries still within TTL. */
export function resumeSeeding(): void {
  if (!paused) return;
  paused = false;
  const now = Date.now();
  // Remove expired entries first.
  for (let i = seedQueue.length - 1; i >= 0; i--) {
    if (now - seedQueue[i].watchedAt > SEED_TTL_MS) {
      seedQueue.splice(i, 1);
    }
  }
  for (const entry of seedQueue) {
    acquireHold(entry);
  }
  if (seedQueue.length > 0) ensureTimer();
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function acquireHold(entry: SeedEntry): void {
  if (entry.holding) return;
  entry.holding = true;
  requestUrl(entry.magnetLink, entry.torrentFileUrl).catch(() => {
    entry.holding = false;
  });
}

function releaseHold(entry: SeedEntry): void {
  if (!entry.holding) return;
  entry.holding = false;
  release(entry.magnetLink);
}

function evict(): void {
  const now = Date.now();

  // Remove expired entries (oldest first = end of array).
  while (seedQueue.length > 0) {
    const oldest = seedQueue[seedQueue.length - 1];
    if (now - oldest.watchedAt > SEED_TTL_MS) {
      releaseHold(oldest);
      seedQueue.pop();
    } else {
      break;
    }
  }

  // Enforce count limit.
  while (seedQueue.length > MAX_SEEDS) {
    const removed = seedQueue.pop()!;
    releaseHold(removed);
  }

  // Enforce byte budget.
  let totalBytes = seedQueue.reduce((sum, e) => sum + e.bytesEstimate, 0);
  while (totalBytes > BYTE_BUDGET && seedQueue.length > 1) {
    const removed = seedQueue.pop()!;
    releaseHold(removed);
    totalBytes -= removed.bytesEstimate;
  }
}

function runEviction(): void {
  evict();
  if (seedQueue.length === 0) stopTimer();
}

function ensureTimer(): void {
  if (evictionTimer) return;
  evictionTimer = setInterval(runEviction, EVICTION_INTERVAL_MS);
}

function stopTimer(): void {
  if (!evictionTimer) return;
  clearInterval(evictionTimer);
  evictionTimer = null;
}
