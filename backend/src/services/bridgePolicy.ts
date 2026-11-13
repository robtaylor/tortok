// What keeps a bridged post out (Decision 0023 items 1 and 4), shared by the
// firehose (at index time) and the engagement poller (on every check), so
// both apply one rule. Both judge from what's stored, so a label from any
// writer counts.
//
// - A post is excluded when `labels` holds a live label in the NSFW set on it.
// - An author is excluded when `bridge_authors.nobridge` is set (#nobridge in
//   their bio or display name), or `labels` holds a live label in the NSFW
//   set, or the opt-out label, on their account.
//
// What's stored about an author is only as fresh as the poller's last read of
// their profile. authorReadIsFresh is the one rule for how long a read
// stands: the poller reads an author again once it lapses, and the firehose
// acts on an exclusion only until it does (Decision 0024 item 3). The two
// must agree, or an author who opted back in is never read again.

import type { QueryFn } from '../db';
import { BSKY_POST_NSID } from '../atproto/bskyPost';
import { accountSubjects, labelledAny, OPT_OUT_LABEL } from '../atproto/labels';

const NOBRIDGE_RE = /#nobridge\b/i;

const AUTHOR_READ_MS = 24 * 60 * 60_000;

/** Whether a read of an author's profile at `refreshedAt` still stands at `now`. */
export function authorReadIsFresh(refreshedAt: Date, now: Date): boolean {
  return now.getTime() - refreshedAt.getTime() < AUTHOR_READ_MS;
}

/** `#nobridge` in a bio or display name (Decision 0023 item 4). */
export function saysNoBridge(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => typeof t === 'string' && NOBRIDGE_RE.test(t));
}

export function postExcluded(db: QueryFn, uri: string, nsfwLabels: ReadonlySet<string>): Promise<boolean> {
  return labelledAny(db, [uri], nsfwLabels);
}

const accountLabelled = (db: QueryFn, did: string, nsfwLabels: ReadonlySet<string>) =>
  labelledAny(db, accountSubjects(did), [...nsfwLabels, OPT_OUT_LABEL]);

/** Whether what's stored excludes this author. The poller asks this straight after reading them. */
export async function authorExcluded(db: QueryFn, did: string, nsfwLabels: ReadonlySet<string>): Promise<boolean> {
  const [row] = await db<{ nobridge: boolean }>('SELECT nobridge FROM bridge_authors WHERE did = $1', [did]);
  if (row?.nobridge) return true;
  return accountLabelled(db, did, nsfwLabels);
}

/**
 * Whether the firehose should act on a stored exclusion: the author is
 * excluded, and the poller's read of them still stands. False for an author
 * it has never read, or not lately, whatever is stored: their post is indexed
 * instead, so its first check reads them again.
 */
export async function exclusionStands(db: QueryFn, did: string, nsfwLabels: ReadonlySet<string>, now: Date): Promise<boolean> {
  const [row] = await db<{ nobridge: boolean; refreshed_at: Date }>(
    'SELECT nobridge, refreshed_at FROM bridge_authors WHERE did = $1', [did]);
  if (!row || !authorReadIsFresh(row.refreshed_at, now)) return false;
  return row.nobridge || accountLabelled(db, did, nsfwLabels);
}

/** Delete a bridged row if there is one; true if there was. */
export async function deleteBridged(db: QueryFn, uri: string): Promise<boolean> {
  return (await db('DELETE FROM posts WHERE at_uri = $1 RETURNING 1', [uri])).length > 0;
}

/**
 * Delete every bridged row by these authors, and return how many there were.
 * Only bridged rows: an author's own tortok posts aren't the bridge's to drop.
 */
export async function deleteBridgedBy(db: QueryFn, dids: string[]): Promise<number> {
  if (dids.length === 0) return 0;
  const gone = await db(`DELETE FROM posts WHERE collection = '${BSKY_POST_NSID}' AND did = ANY($1) RETURNING 1`, [dids]);
  return gone.length;
}
