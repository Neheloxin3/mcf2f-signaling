# MCF2F Cloudflare Workers signaling relay

This is a Cloudflare Workers adaptation of the signaling protocol observed in the uploaded Fabric mod. It handles `join`, `offer`, and `answer` messages and uses a Durable Object to coordinate WebSocket peers.

## Deploy from your Mac (free-tier-compatible setup)

Requirements: Node.js installed and a Cloudflare account.

1. Extract this folder.
2. Open Terminal and `cd` into `mcf2f-cloudflare-worker`.
3. Run `npm install`.
4. Run `npx wrangler login` and complete the browser login.
5. Run `npm run deploy` and follow any prompts. The first deploy creates the Durable Object binding/migration and publishes the Worker.
6. Wrangler prints a URL like `https://mcf2f-relay.<your-subdomain>.workers.dev`.
7. Check `https://mcf2f-relay.<your-subdomain>.workers.dev/health`; it should return `{"status":"ok","service":"mcf2f-signaling-server"}`.

## Important: update the mod endpoint

The uploaded `fabric-1.0.0-SNAPSHOT.jar` has the endpoint hard-coded as `wss://mcf2f-relay.onrender.com`. Deploying this Worker creates a different `workers.dev` hostname; it will NOT automatically make the existing JAR use Cloudflare.

To use the Cloudflare endpoint, you need the mod's source code and must change its WebSocket URL to `wss://mcf2f-relay.<your-subdomain>.workers.dev/`, then rebuild the mod. If you only have the JAR and not the source, ask the mod author for a configurable endpoint or source/release that supports your URL. Do not assume changing a setting in Cloudflare changes the URL embedded in the JAR.

## Notes

- `/health` is a normal HTTP health endpoint.
- The WebSocket relay uses the same message shapes as the Node server: `join`, `offer`, and `answer`.
- This is a small hobby/testing implementation; test two clients before relying on it. Free-tier limits apply. Durable Objects are available on Workers Free, but only SQLite-backed Durable Objects are supported on the Free plan.
