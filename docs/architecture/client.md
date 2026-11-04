# Client (Expo / React Native)

*Reference doc — **stub.** The full present-tense write-up of the Expo client
(feed, player, navigation, state, the WebTorrent integration surface it consumes)
is pending the post-migration area-doc backfill, which checks every claim against
the code. The decision record below is authoritative for the design; the P2P
pieces the client uses are documented in [p2p-torrent](p2p-torrent.md).*

This area covers the cross-platform client: an Expo + React Native + TypeScript
app targeting iOS, Android, and web, with a vertical video feed.

## Implementation status

The Expo client shipped in Phase 1 (feed with react-native-video, feature parity
with the retired Swift prototype minus P2P) and gained the WebTorrent integration
in Phase 2. Verified current-state write-up is part of the adoption follow-up.

## Decisions behind this

- [Decision 0004 — Client is Expo + React Native + TypeScript](decisions/0004-client-expo-react-native.md)
