# ADR-002: Federation protocol is AT Protocol

**Status:** Accepted. Amended 2026-04-29 — NSID is `app.tortok.video.post`
(reverse-DNS rooted at `tortok.app`); see ADR-012. The example record
shape below has been updated to match the formal Lexicon definition in
`lexicons/app/tortok/video/post.json` (notably `aspectRatio` is now
`{width: int, height: int}` to match `app.bsky.embed.defs#aspectRatio`).

**Context.** Publishing is the central design question. We need federation,
identity, and attestation. Options surveyed: ActivityPub (the PeerTube /
Loops lineage), AT Protocol (Bluesky), Nostr, and rolling our own.

**Decision.** Adopt AT Protocol. Define a custom Lexicon,
`app.tortok.video.post`, with this shape:

```json
{
  "$type": "app.tortok.video.post",
  "magnetUri": "magnet:?xt=urn:btih:...",
  "infoHash": "hex",
  "durationMs": 15230,
  "aspectRatio": { "width": 1080, "height": 1920 },
  "caption": "string (max 300 graphemes)",
  "thumbnailBlob": { "$type": "blob", "ref": "...", "mimeType": "image/jpeg" },
  "hashtags": ["#tortok", "#demo"],
  "hlsFallbackUrl": "https://webseed.tortok.example/video/abc.m3u8",
  "createdAt": "2026-04-11T12:00:00Z"
}
```

Videos are published as signed AT Protocol records. Federation is via the
standard atproto pipeline: client → PDS → firehose → AppView.

**Consequences.**
- Attestation comes for free: every record is cryptographically signed by
  the author's DID. No bolt-on signing layer.
- Account portability: users can move PDS without losing handle, followers,
  or post history.
- We get a real schema (Lexicons) instead of hand-rolled JSON.
- The firehose + AppView pattern is designed for million-user-scale
  aggregation; we are not inventing scalability.
- Coupling: atproto has one dominant implementer (Bluesky PBC). Lexicon
  namespace governance (who owns `tortok.*`?) is not fully settled. We
  mitigate by running our own AppView instead of depending on Bluesky's
  infrastructure to index TorTok records.

**Alternatives ruled out.**
- **ActivityPub (PeerTube / Loops).** Server-to-server push model scales
  linearly with followers and requires every instance to be reachable.
  PeerTube has hit this ceiling repeatedly. Account portability is weak;
  identity is tied to the originating server. Attestation is not native.
- **Nostr (NIP-71 video events).** Event model is strong and keypair-native,
  but designed for small text posts. Media publishing is underspecified.
  Relay economics are fragile. No schema system. No account-recovery story;
  losing a key loses the account.
- **Custom protocol.** We would spend the next year building what AT
  Protocol already ships.
- **W3C DIDs + Verifiable Credentials alone.** Gives us identity and
  attestation but no federation primitive. We would still need to invent
  the publish/aggregate layer.
