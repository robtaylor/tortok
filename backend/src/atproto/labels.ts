// atproto labels (com.atproto.label.defs#label), stored in `labels` whatever
// happens to their subject (Decision 0023 item 2). Two sources in v1:
// self-labels on records and profiles (replaceSelfLabels), and the labels
// Bluesky's AppView returns on getPosts (viewLabels + upsertLabels). Policy
// over them, such as the NSFW set, lives in the callers.

import type { QueryFn } from '../db';
import { isObject } from './videoPost';

export interface Label {
  /** An AT-URI or a DID. */
  subject: string;
  /** Labeler DID; the author's DID for a self-label. */
  src: string;
  val: string;
  neg: boolean;
  /** Set when the label applies to one version of a record. */
  subjectCid: string | null;
  cts: Date;
  exp: Date | null;
}

/**
 * A profile self-label asking apps not to show the account to logged-out
 * viewers; the bridge treats it as opting out (Decision 0023 item 4).
 */
export const OPT_OUT_LABEL = '!no-unauthenticated';

/**
 * The subjects an account's labels can have: its DID (labeler labels on the
 * account) and its profile record (where profile self-labels live).
 */
export const accountSubjects = (did: string): string[] => [did, `at://${did}/app.bsky.actor.profile/self`];

/** The DID a label subject (a DID or an AT-URI) belongs to. */
const subjectDid = (subject: string) => (subject.startsWith('at://') ? subject.slice(5).split('/')[0] : subject);

// The lexicon caps a label value at 128 bytes.
const MAX_VAL = 128;

const validVal = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && Buffer.byteLength(v) <= MAX_VAL;

function date(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The self-labels on a record or profile (its `labels` field, a
 * com.atproto.label.defs#selfLabels). Self-labels have no timestamp of
 * their own, so `cts` is the record's createdAt (or when it was seen).
 * Malformed entries are skipped: a record's labels are never a reason to
 * reject the record.
 */
export function selfLabels(subject: string, authorDid: string, record: unknown, cts: Date): Label[] {
  if (!isObject(record) || !isObject(record.labels)) return [];
  const { values } = record.labels;
  if (!Array.isArray(values)) return [];
  return values
    .filter((v): v is { val: string } => isObject(v) && validVal(v.val))
    .map(({ val }) => ({ subject, src: authorDid, val, neg: false, subjectCid: null, cts, exp: null }));
}

/**
 * Labels as an AppView or labeler returns them (getPosts `labels` arrays).
 * Entries missing a source, subject, value or timestamp are skipped. A
 * self-label (its source is the subject's own DID) loses its record CID:
 * self-labels belong to whatever the record currently is, as the firehose
 * stores them, so each is one row and replaceSelfLabels can remove it.
 */
export function viewLabels(labels: unknown): Label[] {
  if (!Array.isArray(labels)) return [];
  const out: Label[] = [];
  for (const l of labels) {
    if (!isObject(l) || typeof l.src !== 'string' || typeof l.uri !== 'string' || !validVal(l.val)) continue;
    const cts = date(l.cts);
    if (!cts) continue;
    const self = l.src === subjectDid(l.uri);
    out.push({
      subject: l.uri, src: l.src, val: l.val, neg: l.neg === true,
      subjectCid: !self && typeof l.cid === 'string' ? l.cid : null, cts, exp: date(l.exp),
    });
  }
  return out;
}

/** True if any label is a live (not negated, not expired) one in `vals`. */
export function hasLabel(labels: Label[], vals: ReadonlySet<string>, now = new Date()): boolean {
  return labels.some((l) => !l.neg && vals.has(l.val) && (l.exp === null || l.exp > now));
}

/**
 * True if `labels` holds a live (not negated, not expired) label in `vals`
 * on any of `subjects`: the stored counterpart of hasLabel.
 */
export async function labelledAny(db: QueryFn, subjects: string[], vals: Iterable<string>): Promise<boolean> {
  const rows = await db(
    `SELECT 1 FROM labels
      WHERE subject = ANY($1) AND val = ANY($2) AND NOT neg AND (exp IS NULL OR exp > NOW())
      LIMIT 1`,
    [subjects, [...vals]]);
  return rows.length > 0;
}

/**
 * Store labels, one row per (subject, subject CID, src, val). A row changes
 * only for a newer label, or a same-time one that differs, so a negation
 * replaces what it negates, a stale replay doesn't undo it, and re-reading
 * an unchanged label writes nothing.
 */
export async function upsertLabels(db: QueryFn, labels: Label[]): Promise<void> {
  // One INSERT can't touch a row twice, so keep the latest label per key.
  const latest = new Map<string, Label>();
  for (const l of labels) {
    const key = JSON.stringify([l.subject, l.subjectCid ?? '', l.src, l.val]);
    const seen = latest.get(key);
    if (!seen || l.cts >= seen.cts) latest.set(key, l);
  }
  if (latest.size === 0) return;
  const ls = [...latest.values()];
  await db(
    `INSERT INTO labels (subject, subject_cid, src, val, neg, cts, exp)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::bool[], $6::timestamptz[], $7::timestamptz[])
     ON CONFLICT (subject, subject_cid, src, val) DO UPDATE SET
       neg = EXCLUDED.neg, cts = EXCLUDED.cts, exp = EXCLUDED.exp, indexed_at = NOW()
     WHERE EXCLUDED.cts > labels.cts
        OR (EXCLUDED.cts = labels.cts AND (EXCLUDED.neg, EXCLUDED.exp) IS DISTINCT FROM (labels.neg, labels.exp))`,
    [
      ls.map((l) => l.subject), ls.map((l) => l.subjectCid ?? ''), ls.map((l) => l.src),
      ls.map((l) => l.val), ls.map((l) => l.neg), ls.map((l) => l.cts), ls.map((l) => l.exp),
    ],
  );
}

/**
 * Make `labels` hold exactly these self-labels for a subject. Self-labels
 * are a set each record version replaces, so one the author has removed is
 * deleted rather than left live.
 */
export async function replaceSelfLabels(db: QueryFn, subject: string, authorDid: string, labels: Label[]): Promise<void> {
  if (labels.some((l) => l.subject !== subject || l.src !== authorDid)) {
    throw new Error(`replaceSelfLabels: every label must be ${authorDid}'s self-label on ${subject}`);
  }
  await db(
    `DELETE FROM labels WHERE subject = $1 AND src = $2 AND subject_cid = '' AND NOT (val = ANY($3::text[]))`,
    [subject, authorDid, labels.map((l) => l.val)],
  );
  await upsertLabels(db, labels);
}
