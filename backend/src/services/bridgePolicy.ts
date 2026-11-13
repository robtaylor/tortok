// What keeps a bridged post out (Decision 0023 items 1 and 4), shared by the
// firehose (at index time) and the engagement poller (on every check), so
// both apply one rule. Both judge from what's stored, so a label from any
// writer counts.
//
// - A post is excluded when `labels` holds a live label in the NSFW set on it.
// - An author is excluded when `bridge_authors.nobridge` is set (#nobridge in
//   their bio or display name), or `labels` holds a live label in the NSFW
//   set, or the opt-out label, on their account.

import type { QueryFn } from '../db';
import { accountSubjects, labelledAny, OPT_OUT_LABEL } from '../atproto/labels';

const NOBRIDGE_RE = /#nobridge\b/i;

/** `#nobridge` in a bio or display name (Decision 0023 item 4). */
export function saysNoBridge(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => typeof t === 'string' && NOBRIDGE_RE.test(t));
}

export function postExcluded(db: QueryFn, uri: string, nsfwLabels: ReadonlySet<string>): Promise<boolean> {
  return labelledAny(db, [uri], nsfwLabels);
}

export async function authorExcluded(db: QueryFn, did: string, nsfwLabels: ReadonlySet<string>): Promise<boolean> {
  const [row] = await db<{ nobridge: boolean }>('SELECT nobridge FROM bridge_authors WHERE did = $1', [did]);
  if (row?.nobridge) return true;
  return labelledAny(db, accountSubjects(did), [...nsfwLabels, OPT_OUT_LABEL]);
}

/** Delete a bridged row if there is one; true if there was. */
export async function deleteBridged(db: QueryFn, uri: string): Promise<boolean> {
  return (await db('DELETE FROM posts WHERE at_uri = $1 RETURNING 1', [uri])).length > 0;
}
