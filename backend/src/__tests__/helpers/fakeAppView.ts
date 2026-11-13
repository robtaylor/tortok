// A stand-in for Bluesky's AppView: answers app.bsky.feed.getPosts and
// app.bsky.actor.getProfiles from a stub, read on every call so a test can
// change it between polls, and records the calls it gets.

import { accountSubjects } from '../../atproto/labels';

/** Bluesky's moderation labeler. */
export const MOD = 'did:plc:ar7c4by46qjdydhdevvrndac';

export interface AppViewStub {
  posts: Record<string, unknown>[];
  profiles: Record<string, unknown>[];
  /** Answer every call with this HTTP status instead. */
  status?: number;
}

export function fakeAppView(stub: AppViewStub) {
  const calls: { method: string; params: string[] }[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const method = url.pathname.replace('/xrpc/', '');
    const params = [...url.searchParams.values()];
    calls.push({ method, params });
    if (stub.status) return new Response('{}', { status: stub.status });
    if (method === 'app.bsky.feed.getPosts') {
      return Response.json({ posts: stub.posts.filter((p) => params.includes(p.uri as string)) });
    }
    return Response.json({ profiles: stub.profiles.filter((p) => params.includes(p.did as string)) });
  }) as typeof globalThis.fetch;
  return { fetch: fetchFn, calls };
}

/** A getPosts post view: no engagement and no labels unless given. */
export const postView = (uri: string, over: Record<string, unknown> = {}) =>
  ({ uri, likeCount: 0, repostCount: 0, labels: [], author: { labels: [] }, ...over });

/** A getProfiles profile view: 10 followers and no labels unless given. */
export const profileView = (did: string, over: Record<string, unknown> = {}) =>
  ({ did, handle: 'alice.bsky.social', displayName: 'Alice', followersCount: 10, labels: [], ...over });

/** A label as the AppView returns it; from Bluesky's labeler unless `src` says otherwise. */
export const lbl = (uri: string, val: string, src = MOD, extra: object = {}) =>
  ({ src, uri, val, cts: '2026-11-12T11:00:00Z', ...extra });

/** The subject of an account's profile self-labels. */
export const profileUri = (did: string) => accountSubjects(did)[1];
