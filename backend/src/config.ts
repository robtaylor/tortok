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
