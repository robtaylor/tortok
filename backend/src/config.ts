// Settings read from the environment by more than one module.

/**
 * A required setting in production; outside production, a local-dev default.
 * Deployed environments set these explicitly (backend/fly.toml [env]).
 */
export function envOrDevDefault(name: string, devDefault: string): string {
  const value = process.env[name];
  if (value !== undefined) return value;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} must be set in production`);
  }
  return devDefault;
}

/**
 * tortok's own trackers (`TRACKER_URLS`, comma-separated), listed as extra
 * trackers on every feed item (Decision 0022). Local dev uses the tracker
 * from scripts/dev-up.sh.
 */
export function trackerUrls(): string[] {
  const urls = splitList(envOrDevDefault('TRACKER_URLS', 'ws://localhost:8000'));
  if (urls.length === 0) throw new Error('TRACKER_URLS is set but contains no tracker URLs');
  return urls;
}

const splitList = (raw: string): string[] => raw.split(',').map((v) => v.trim()).filter(Boolean);

/** A comma-separated setting, trimmed, empty entries dropped. */
export function envList(name: string, fallback: string): string[] {
  return splitList(process.env[name] ?? fallback);
}

/**
 * Label values that keep a bridged Bluesky post out of the index
 * (`BRIDGE_NSFW_LABELS`, comma-separated; Decision 0023 item 1). The default
 * is the decision's set. Read it once at startup, not per post.
 */
export function bridgeNsfwLabels(): ReadonlySet<string> {
  const vals = envList('BRIDGE_NSFW_LABELS', 'porn,sexual,nudity,graphic-media,gore,!hide,!takedown');
  if (vals.length === 0) throw new Error('BRIDGE_NSFW_LABELS is set but contains no label values');
  return new Set(vals);
}

/**
 * The narrowest bridged video the feed takes, as height/width
 * (`BRIDGE_ASPECT_MIN`; default 1, square or portrait; Decision 0010).
 */
export function bridgeAspectMin(): number {
  return envNumber('BRIDGE_ASPECT_MIN', 1);
}

/** A `true`/`false` setting, or `fallback` when unset; anything else is an error, not a guess. */
export function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false, not ${raw}`);
}

/** A positive number setting, or `fallback` when unset. */
export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = Number(raw);
  if (!(v > 0)) throw new Error(`${name} must be a positive number, not ${raw}`);
  return v;
}

/**
 * When a bridged post reaches the feed (Decision 0023 item 5): at least
 * `minLikes` likes or `minReposts` reposts, or an author with `minFollowers`
 * followers, within `qualifyDays` of being posted; otherwise it is dropped.
 */
export interface BridgeThresholds {
  minLikes: number;
  minReposts: number;
  minFollowers: number;
  qualifyDays: number;
}

export function bridgeThresholds(): BridgeThresholds {
  return {
    minLikes: envNumber('BRIDGE_MIN_LIKES', 50),
    minReposts: envNumber('BRIDGE_MIN_REPOSTS', 10),
    minFollowers: envNumber('BRIDGE_MIN_FOLLOWERS', 5000),
    qualifyDays: envNumber('BRIDGE_QUALIFY_DAYS', 7),
  };
}

/**
 * Where bridged videos' playlists and thumbnails are served
 * (`BRIDGE_VIDEO_BASE`; default Bluesky's video service). The e2e stack
 * points it at its own content server, which serves a local HLS fixture.
 */
export function bridgeVideoBase(): string {
  return (process.env.BRIDGE_VIDEO_BASE ?? 'https://video.bsky.app/watch').replace(/\/+$/, '');
}
