# oauth-client-metadata.json

This file is a **bundled copy** of the canonical atproto OAuth client
metadata. The canonical location — and the value of `client_id` inside
the file — is:

    https://tortok.app/.well-known/oauth-client-metadata.json

The source-of-truth file lives in this repo at:

    web/public/.well-known/oauth-client-metadata.json

Both copies must stay byte-identical. If you change one, change the
other. The bundle copy exists because metro's project root is
`tortok/`, and reaching above it (e.g. `../../web/public/...`) breaks
the bundler at runtime.

A future CI check should diff these two files on every PR.

Loaded by `tortok/lib/atproto/oauth.ts`.
