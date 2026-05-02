// Hermes (and some older web runtimes) lacks AbortSignal.timeout (TC39
// 2022). atproto's oauth-client uses it for PAR and token-endpoint
// timeouts; without this polyfill, signIn throws synchronously.
//
// Mirrors the polyfill in lib/webtorrent/polyfills.native.ts (lines
// 41–54), which is only loaded on the WebTorrent code path. This module
// is imported from app/_layout.tsx so it covers the whole app.

if (typeof AbortSignal.timeout !== 'function') {
  AbortSignal.timeout = (ms: number): AbortSignal => {
    const controller = new AbortController();
    setTimeout(() => {
      const err = new Error('TimeoutError');
      err.name = 'TimeoutError';
      controller.abort(err);
    }, ms);
    return controller.signal;
  };
}

if (typeof AbortSignal.prototype.throwIfAborted !== 'function') {
  AbortSignal.prototype.throwIfAborted = function (this: AbortSignal): void {
    if (this.aborted) {
      throw (this as AbortSignal & { reason?: unknown }).reason ?? new Error('AbortError');
    }
  };
}
