# web/

Static site for `tortok.app`. Intended deploy target: **Cloudflare Pages** (consistent with our existing Cloudflare/R2 footprint from Decision 0008). Hosts the atproto OAuth client metadata document, the OAuth auth callback shim, and a placeholder marketing page. Cloudflare Pages deploy is not yet configured — that is a separate follow-up task.

The Expo web build deploys separately to the `app.tortok.app` subdomain (option (a) in the Phase 3 plan). That build is not part of this directory.

## File layout

```
web/
  public/
    index.html                          # Placeholder marketing page
    .well-known/
      oauth-client-metadata.json        # atproto OAuth client metadata
    auth/
      callback.html                     # OAuth redirect callback shim
```

## oauth-client-metadata.json

The `client_id` field is the canonical URL of this file once hosted
(`https://tortok.app/.well-known/oauth-client-metadata.json`). Per the
atproto OAuth spec, the `client_id` must be a reachable URL; local or
`localhost` client IDs only work against PDSes that allow loopback clients.

## auth/callback.html

Handles the browser redirect from the user's PDS after OAuth authorization.

- **Native app installed:** deep-links to `app.tortok:/auth/callback?…` so
  the Expo client receives the params and calls `oauth.handleCallback(url)`.
- **Web build / no app:** loads `@atproto/oauth-client-browser` from
  `esm.sh` and calls `client.callback()` directly, then redirects to
  `https://app.tortok.app`.

Note: the native deep-link scheme uses a **single slash** (`app.tortok:/auth/callback`),
not a double slash. This is intentional — it matches how `app.config.ts`
must declare `scheme: "app.tortok"` in the Expo client (Track 2 of Unit 2).

## No build step

No package.json, no bundler, no framework. Files are served as-is by
Cloudflare Pages from the `web/public/` directory.

## Deploying

### Prerequisites

1. Add the following to the root `.env` (copy from `.env.example`):

   ```
   CLOUDFLARE_API_TOKEN=<token>
   CLOUDFLARE_ACCOUNT_ID=<account-id>
   ```

   Get a token at https://dash.cloudflare.com/profile/api-tokens with permissions:
   - Account — **Cloudflare Pages: Edit**
   - Zone — **DNS: Edit** (for tortok.app)

   Your Account ID appears in the URL of any Cloudflare dashboard page.

2. Install dependencies (wrangler is a devDependency):

   ```
   npm install
   ```

### Deploy

```
npm run deploy:web
```

The script is idempotent — safe to re-run. It creates the `tortok-web` Pages
project if it doesn't exist, then deploys `web/public/` to the production
branch. Wrangler prints the deployment URL on success.

### One-time manual step: custom domain binding

Wrangler 4.x has no CLI command for binding custom domains to a Pages project.
After the first deploy, you must bind `tortok.app` once via the dashboard:

```
https://dash.cloudflare.com/<ACCOUNT_ID>/pages/view/tortok-web/domains
```

Click **Add a custom domain** and enter `tortok.app`. Cloudflare will
automatically add the required DNS record if `tortok.app` is already in your
account's DNS zone. The script prints this URL each time it runs as a reminder
until the binding is confirmed.
