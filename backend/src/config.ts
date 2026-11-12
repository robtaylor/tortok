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
  const urls = envOrDevDefault('TRACKER_URLS', 'ws://localhost:8000')
    .split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) throw new Error('TRACKER_URLS is set but contains no tracker URLs');
  return urls;
}
