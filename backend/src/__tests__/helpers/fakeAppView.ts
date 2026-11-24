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
  /** Answer 414 to a URL longer than this, as Bluesky's AppView does past about 8,000 characters. */
  maxUrl?: number;
  /** Answer 502 to every call from this one on, counting from 1. */
  failsFromCall?: number;
}

export function fakeAppView(stub: AppViewStub) {
  const calls: { method: string; params: string[]; urlLength: number }[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const method = url.pathname.replace('/xrpc/', '');
    const params = [...url.searchParams.values()];
    calls.push({ method, params, urlLength: String(input).length });
    if (stub.status) return new Response('{}', { status: stub.status });
    if (stub.failsFromCall && calls.length >= stub.failsFromCall) return new Response('{}', { status: 502 });
    if (stub.maxUrl && String(input).length > stub.maxUrl) return new Response('', { status: 414 });
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
