// TypeScript can't see Metro's platform-specific extensions
// (`polyfills.native.ts` vs `polyfills.web.ts`) when the import path is
// `@/lib/webtorrent/polyfills`. This declaration tells TS the module exists
// and is side-effect-only — the actual implementation is picked by Metro at
// bundle time based on platform.
declare module '@/lib/webtorrent/polyfills';
