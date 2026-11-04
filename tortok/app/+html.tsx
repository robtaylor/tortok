// Custom root HTML for Expo Router web. We use this to inject a tiny `process`
// shim into globalThis BEFORE the Metro bundle's preamble runs.
//
// Metro web bundles begin with a hoisted `var process = globalThis.process || {}`,
// which captures whatever's on globalThis at script-tag execution time. Modules
// like `end-of-stream` then read bare `process.nextTick`, which throws if the
// captured object is empty. On Hermes the React Native runtime supplies a
// process global before the bundle loads, so this isn't an issue there.
//
// For the web build (WebTorrent and other Node-shaped deps), we need the shim
// populated up-front. The shim is inline raw JS rather
// than `import process from 'process'` because at the point `<head>` runs
// there is no module system — Metro's bundle (which provides CJS/ESM) hasn't
// been loaded yet, and that's precisely the problem we're solving.
//
// See Decision 0009 for the WebTorrent integration context.

import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const PROCESS_SHIM = `
  if (typeof globalThis.process === 'undefined' || typeof globalThis.process.nextTick !== 'function') {
    var __p = globalThis.process || {};
    __p.env = __p.env || {};
    __p.browser = true;
    if (typeof __p.nextTick !== 'function') {
      __p.nextTick = function (cb) {
        var args = Array.prototype.slice.call(arguments, 1);
        Promise.resolve().then(function () { cb.apply(null, args); });
      };
    }
    if (typeof __p.cwd !== 'function') __p.cwd = function () { return '/'; };
    if (typeof __p.platform === 'undefined') __p.platform = 'browser';
    if (typeof __p.version === 'undefined') __p.version = '';
    if (typeof __p.versions === 'undefined') __p.versions = {};
    globalThis.process = __p;
  }
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <script dangerouslySetInnerHTML={{ __html: PROCESS_SHIM }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
