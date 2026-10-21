# Convex behind the Start app

Researched 2026-10-21. Builds on `research/convex-monolith` and `research/better-auth-convex`. Goal: the browser only reaches `https://chat.iadw.in` (Caddy → Start on :3000). Convex on :3210 stays internal.

Pinned sources: convex-backend `95d8719` (convex npm `1.47.0`), nitro `2c35c25` (`3.0.260903-beta`), h3 `9d70cf3` (`2.0.7`), crossws `2e523be` (`0.4.15`), TanStack/router `ed55775`, get-convex/better-auth `3f41cbc`, convex-react-query `b175405`, convex-helpers `c248fba`.

Nothing below was run. Every recipe is untested.

## Answers

1. **Proxying through Start is feasible but not with `routeRules`.** h3's proxy is `fetch`-based and always drops `upgrade`. Nitro can do it with a route that combines `defineWebSocketHandler` + crossws `createWebSocketProxy` (for WS) and h3 `proxy` (for HTTP), with `features.websocket: true`. **Lightest option: Caddy** `handle_path /convex/*` → `127.0.0.1:3210`. It strips the prefix and tunnels WebSockets natively, with no app code and no new dependency. Either way, allowlist paths instead of exposing all of :3210.
2. **Yes.** convex-js only checks for an `http(s)://` prefix and a parseable URL, then appends `/api/...` by string concatenation. `https://chat.iadw.in/convex` works (no trailing slash). Build it at runtime with `createIsomorphicFn`: `${location.origin}/convex` on the client, `http://127.0.0.1:3210` on the server.
3. **Yes, and loopback is the better choice.** Convex accepts `http://` issuers and fetches JWKS with no scheme check. The default self-hosted origins are loopback anyway. `"use node"` actions call back to the backend through `CONVEX_CLOUD_ORIGIN` and drop any path prefix, so a public `/convex`-prefixed origin would break them. The catch is storage URLs, which become loopback. Fix that with a canonical ConvexCloud URL (`https://chat.iadw.in/convex`).
4. **Confirmed.** Sync auth is an `Authenticate` message carrying the JWT inside the socket. The sync endpoint reads no cookies or auth headers. The Better Auth component already gets the JWT from a same-origin, httpOnly-cookie endpoint. Passing a session ID as an argument (convex-helpers) works but gives up `ctx.auth` and httpOnly.

## 1. Proxying :3210 under `/convex`

### What doesn't work

- Nitro `routeRules: { '/convex/**': { proxy: ... } }` uses h3's proxy rule, which calls `proxyRequest` ([h3 rules/proxy.ts][h3-rule]). That is a plain `fetch`. `upgrade` and `connection` are on the always-dropped hop-by-hop list, and `forwardHeaders` cannot override them ([h3 utils/proxy.ts#L30-L37][h3-proxy], [internal/proxy.ts][h3-int]). **No WebSocket.**
- With `features.websocket` on, an upgrade request runs through `nitroApp.fetch` to find crossws hooks on the response ([nitro app.ts#L63][nitro-app]). A proxy rule would answer with a `fetch` response and no hooks.
- A raw `node:http` `upgrade` listener plus httpxy has no hook: the `node-server` entry only attaches crossws to `server.on("upgrade")`, and only when websocket is enabled ([node-server.ts#L16-L27][nitro-node]). Using it would mean a custom preset or entry. Not worth it.

### What works in Nitro (untested)

crossws ships `createWebSocketProxy` (since 0.4.5). It terminates the client socket and opens one upstream socket per peer, relaying text and binary frames both ways. On Node it dials with the global `WebSocket` (Node ≥ 22) ([crossws proxy.md][cw-doc], [proxy.ts#L229][cw-src]). Nitro uses it for its own dev proxy ([nitro dev/_proxy.ts][nitro-devproxy]). `defineWebSocketHandler(hooks, http)` sends upgrades to `hooks` and plain requests to `http` on the same route ([h3 ws.ts][h3-ws]). Explicit routes take priority over the renderer that serves Start ([nitro server-entry.md][nitro-entry]).

```ts
// vite.config.ts
nitro({ serverDir: "./server", features: { websocket: true } })
```

```ts
// server/routes/convex/[...path].ts
import { defineHandler, defineWebSocketHandler, HTTPError } from "nitro";
import { proxy } from "nitro/h3";
import { createWebSocketProxy } from "crossws";

const upstream = "127.0.0.1:3210";
const toUpstreamPath = (url: URL) => url.pathname.slice("/convex".length) + url.search;
// Only what the browser needs: the sync socket and file storage.
const allowed = /^\/api\/(\d+\.\d+\.\d+\/sync|storage\/)/;

export default defineWebSocketHandler(
  createWebSocketProxy({
    target: (peer) => `ws://${upstream}${toUpstreamPath(new URL(peer.request.url))}`,
    webSocketOptions: { perMessageDeflate: false }, // loopback leg
  }),
  defineHandler((event) => {
    const path = toUpstreamPath(event.url);
    if (!allowed.test(path)) throw new HTTPError("Not found", { status: 404 });
    return proxy(event, `http://${upstream}${path}`);
  }),
);
```

- The WS `target` only controls the path. The host is fixed, so this is not an SSRF primitive ([crossws proxy.md#dynamic-target][cw-doc]). Restricting the WS path to `/api/<v>/sync` needs an `upgrade` hook wrapper that returns 404 for other paths, in the same shape as the doc's auth example.
- `crossws` is a dependency of nitro, not of the app. Importing it directly means adding it to `package.json` (needs your OK).
- h3 `proxy` streams both bodies ([proxy.ts#L185-L470][h3-proxy]), so streaming HTTP actions pass through.
- Costs: two sockets and a JS frame relay per tab inside the Start process. The proxy commits to the client's subprotocol before dialing upstream. Convex opens `new WebSocket(uri)` with no subprotocol, so this does not matter here ([web_socket_manager.ts#L362][ws-mgr]).
- Dev: `nitro/vite` routes Vite `upgrade` events to Nitro ([vite/dev.ts#L195-L214][nitro-vitedev]), so the same route should work under `vite dev`.

### Lightest: Caddy path routing (untested)

Caddy's `reverse_proxy` handles WebSocket upgrades and then tunnels both directions ([reverse_proxy docs][caddy-rp]). `handle_path` is `handle` + `uri strip_prefix` ([handle_path docs][caddy-hp]).

```caddyfile
chat.iadw.in {
	handle_path /convex/* {
		@browser path_regexp ^/api/([0-9.]+/sync|storage/.*)$
		handle @browser {
			reverse_proxy 127.0.0.1:3210
		}
		handle {
			respond 404
		}
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

- Publish the container's 3210 to Caddy only (host loopback or the Docker network), never publicly.
- Caddy closes WebSockets on config reload unless `stream_close_delay` is set ([reverse_proxy docs][caddy-rp]). The Convex client reconnects on its own.
- **Recommendation:** use Caddy. It adds no code or dependency, and Convex traffic never touches the Node event loop. Use the Nitro route only if the app must own the proxy, for example to deploy without Caddy.

### Either way: allowlist

A blanket `/convex/*` → :3210 exposes the admin API (`/api/deploy...`, `/api/update_environment_variables`, `/api/update_canonical_url`, `/api/v1/...`) ([router.rs#L306-L392][router]). These are admin-key protected, but that is the same exposure as a public `api.` hostname. The browser needs only:

- `/api/<version>/sync`: queries, mutations, and actions all go over the socket ([client.ts#L339][client])
- `/api/storage/...`: only if the app serves Convex file storage URLs
- `/api/debug_event`: only with `reportDebugInfoToConvex` ([client.ts#L1107][client-dbg])

## 2. Deployment URL with a path prefix

- `validateDeploymentUrl` requires an `http:`/`https:` prefix, a URL that parses, and no `.convex.site` suffix. Nothing else ([common/index.ts#L23-L61][validate]).
- Sync: `wsUri = ${ws(s)}://${address-after-scheme}/api/${version}/sync`. The path is kept, so `https://chat.iadw.in/convex` → `wss://chat.iadw.in/convex/api/<v>/sync` ([client.ts#L304-L339][client]).
- HTTP client: `${address}/api/query`, `/api/mutation`, `/api/action`, and so on ([http_client.ts#L257-L576][http-client]). A trailing slash would produce `//api`, so omit it.
- `ConvexReactClient` creates the socket lazily, so SSR never opens one ([react/client.ts#L385-L410][react-client]). `ConvexQueryClient` builds its server `ConvexHttpClient` from the same URL ([convex-react-query index.ts#L166-L197][rq]). Different values per environment are fine:

```ts
import { createIsomorphicFn } from "@tanstack/react-start";
const convexUrl = createIsomorphicFn()
  .server(() => "http://127.0.0.1:3210")
  .client(() => `${window.location.origin}/convex`);
// new ConvexQueryClient(convexUrl(), { expectAuth: true })
```

([environment-functions.md][iso]). No `VITE_CONVEX_URL`, and one image works for any hostname. `convexSiteUrl` for the Better Auth proxy and `fetchAuth*` stays server-only: `http://127.0.0.1:3210/http` and `http://127.0.0.1:3210`.

## 3. Loopback `CONVEX_CLOUD_ORIGIN` / `CONVEX_SITE_ORIGIN`

Set `CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210` and `CONVEX_SITE_ORIGIN=http://127.0.0.1:3210/http`.

- **Allowed.** The backend only requires the origins to start with `http://` or `https://`. Its own defaults are `http://127.0.0.1:3210` / `:3211` ([config.rs#L204-L235][config]), and the official compose uses the same values ([docker-compose.yml#L26-L28][compose]).
- **Pitfall:** `run_backend.sh` always passes `--convex-origin "$CONVEX_CLOUD_ORIGIN"`. When unset, the value is `""`, which the backend accepts as "unknown yet" instead of falling back to the default ([run_backend.sh#L55-L64][runbk], [config.rs#L208-L210][config]). Set both explicitly.
- **customJwt with `http://`:** the issuer is parsed with scheme `http` or `https` allowed ([common/auth.rs#L209-L240][auth-rs]). The JWKS URL is parsed as a plain `http::Uri` with no scheme check, and `data:` URLs also work ([authentication/lib.rs#L439-L480][authn]). JWKS is fetched by a `CachedHttpClient` that only goes through an SSRF proxy when `--convex-http-proxy` is set ([local_backend/lib.rs#L218-L232][lb-lib]). `run_backend.sh` never sets it. So issuer `http://127.0.0.1:3210/http` and JWKS `http://127.0.0.1:3210/http/api/auth/convex/jwks` validate over loopback. This **removes the JWKS hairpin pitfall** from `better-auth-convex.md`, so Static JWKS is no longer needed. The component builds both from `CONVEX_SITE_URL` and checks nothing except a `.convex.cloud` suffix ([auth-config.ts#L75-L80][ba-cfg], [plugins/convex/index.ts#L182-L191][ba-plugin], [react-start/index.ts#L53][ba-rs]).

What else reads the origins:

| Consumer | Source of URL | With loopback |
| --- | --- | --- |
| `"use node"` action callbacks | `--convex-origin`, via `new URL("/api/actions/...", origin)` ([executor.rs#L253][ne-rs], [syscalls.ts#L325][ne-ts]) | **Better.** No hairpin. A `/convex`-prefixed public origin would break here because the absolute path drops the prefix. |
| `ctx.storage.getUrl`, `generateUploadUrl` | canonical ConvexCloud URL, else origin → `${origin}/api/storage/...` ([file_storage core.rs#L118-L180][fs]) | Breaks for the browser. Fix below. |
| `process.env.CONVEX_CLOUD_URL` / `CONVEX_SITE_URL` in functions, `auth.config.ts` | canonical URLs, else origins ([udf environment.rs#L71-L84][udf-env]) | Loopback. Fine for Better Auth (backend-only). |
| `ctx.auth.signJwt` issuer | `CONVEX_CLOUD_URL` ([deployment_jwt.rs#L45-L60][djwt]) | Loopback. Unused here. |
| Dashboard, CLI | their own `NEXT_PUBLIC_DEPLOYMENT_URL` / `CONVEX_SELF_HOSTED_URL` | Reach through `ssh -L 3210:127.0.0.1:3210`. Loopback URLs shown in the dashboard then resolve on the laptop too. |
| External webhooks or OAuth callbacks to HTTP actions | public URL | Unreachable unless `/convex/http/*` is allowlisted. None planned. |

**Storage fix:** set a canonical ConvexCloud URL. This overrides the origin for storage URLs and `CONVEX_CLOUD_URL` only. Node callbacks keep using `--convex-origin`. It is stored in the backend DB, so it persists on the volume ([canonical_urls.rs][canon], [router.rs#L312][router]):

```bash
curl -X POST http://127.0.0.1:3210/api/update_canonical_url \
  -H "Authorization: Convex $ADMIN_KEY" -H 'Content-Type: application/json' \
  -d '{"requestDestination":"convexCloud","url":"https://chat.iadw.in/convex"}'
```

(request shape from [dashboard deploymentApi.ts#L155][dash-canon] and [RequestDestination][reqdest]). Do **not** set `convexSite`: it would move `CONVEX_SITE_URL`, and with it the Better Auth issuer and JWKS URL, back to the public hostname. Skip this entirely if the app never hands storage URLs to the browser.

## 4. Sync auth

- The client opens `new WebSocket(uri)` with no subprotocol, so the browser cannot attach headers ([web_socket_manager.ts#L362][ws-mgr]). Identity goes in a protocol message: `{ type: "Authenticate", tokenType: "User", value: <JWT>, baseVersion }` ([protocol.ts#L180-L192][protocol]). The worker validates it ([sync worker.rs#L857-L930][worker]).
- The backend `sync` handler extracts no identity from the upgrade request: no cookie, no `Authorization` ([subs/mod.rs#L424-L480][subs]). HTTP endpoints take `Authorization: Bearer <JWT>` only ([authentication.rs#L55-L80][authn-hdr]). **`ctx.auth` cannot come from a cookie.**
- This costs nothing in practice. The Better Auth component's client fetches the JWT from same-origin `/api/auth/convex/token`, authenticated by the httpOnly session cookie, and hands it to the Convex client (see `better-auth-convex.md`). The browser holds only a 15-minute JWT in memory.
- Side effect of the same-origin proxy: requests to `/convex/http/*` (if allowlisted) carry the app's cookies. HTTP actions could then authenticate with `auth.api.getSession({ headers })`. Cookie auth works for HTTP actions only.

Alternatives, if `ctx.auth` were not wanted:

- **Session ID as an argument** (convex-helpers `SessionProvider`, `useSessionQuery`, and `customQuery` with `SessionIdArg`) ([README#L220-L275][helpers]). Costs: every public function takes `sessionId`. `ctx.auth`, `authComponent.getAuthUser`, and `<Authenticated>` stop working. The secret must be readable by JS, so you lose httpOnly or need a second token. You also write the per-call session lookup yourself. Not worth it here.
- **Proxy-injected `Authenticate`** (only possible with the Nitro relay): read the cookie at upgrade, mint the JWT server-side, and inject or rewrite `Authenticate` frames. The proxy would have to track `baseVersion` and refresh before expiry, fighting the client's own auth state machine. Speculative. Not recommended.

## Resulting layout

```
browser ── https://chat.iadw.in ── Caddy ─┬─ /convex/api/<v>/sync, /convex/api/storage/* → 127.0.0.1:3210 (prefix stripped)
                                          └─ everything else → 127.0.0.1:3000 (Start)
container env: CONVEX_CLOUD_ORIGIN=http://127.0.0.1:3210  CONVEX_SITE_ORIGIN=http://127.0.0.1:3210/http
Convex env:    SITE_URL=https://chat.iadw.in  (+ canonical convexCloud URL only if storage URLs reach the browser)
client:        ConvexQueryClient(`${location.origin}/convex`); server: http://127.0.0.1:3210
```

Spike checklist: WS through Caddy `handle_path`, JWT validation against the loopback issuer, and `getUrl()` after setting the canonical URL.

[h3-rule]: https://github.com/h3js/h3/blob/9d70cf30099281668929e097d1fd0a18778af5d3/src/rules/proxy.ts
[h3-proxy]: https://github.com/h3js/h3/blob/9d70cf30099281668929e097d1fd0a18778af5d3/src/utils/proxy.ts
[h3-int]: https://github.com/h3js/h3/blob/9d70cf30099281668929e097d1fd0a18778af5d3/src/utils/internal/proxy.ts#L8-L40
[h3-ws]: https://github.com/h3js/h3/blob/9d70cf30099281668929e097d1fd0a18778af5d3/src/utils/ws.ts
[nitro-app]: https://github.com/nitrojs/nitro/blob/2c35c25c65cd324af3edc88226d36b32d5f64a2c/src/runtime/internal/app.ts#L63-L72
[nitro-node]: https://github.com/nitrojs/nitro/blob/2c35c25c65cd324af3edc88226d36b32d5f64a2c/src/presets/node/runtime/node-server.ts#L16-L27
[nitro-devproxy]: https://github.com/nitrojs/nitro/blob/2c35c25c65cd324af3edc88226d36b32d5f64a2c/src/dev/_proxy.ts#L18-L122
[nitro-vitedev]: https://github.com/nitrojs/nitro/blob/2c35c25c65cd324af3edc88226d36b32d5f64a2c/src/build/vite/dev.ts#L195-L214
[nitro-entry]: https://github.com/nitrojs/nitro/blob/2c35c25c65cd324af3edc88226d36b32d5f64a2c/docs/1.docs/6.server-entry.md
[cw-doc]: https://github.com/h3js/crossws/blob/2e523be73ad0d74c07f4da4f398df872d88757b7/docs/1.guide/8.proxy.md
[cw-src]: https://github.com/h3js/crossws/blob/2e523be73ad0d74c07f4da4f398df872d88757b7/src/proxy.ts#L229
[caddy-rp]: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
[caddy-hp]: https://caddyserver.com/docs/caddyfile/directives/handle_path
[iso]: https://github.com/TanStack/router/blob/ed5577593a749b8c7193cc7b5d945fd084bfac2f/docs/start/framework/react/guide/environment-functions.md
[validate]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/common/index.ts#L23-L61
[client]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/browser/sync/client.ts#L304-L339
[client-dbg]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/browser/sync/client.ts#L1107
[http-client]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/browser/http_client.ts#L257-L576
[react-client]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/react/client.ts#L385-L410
[ws-mgr]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/browser/sync/web_socket_manager.ts#L362
[protocol]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/convex/src/browser/sync/protocol.ts#L180-L192
[rq]: https://github.com/get-convex/convex-react-query/blob/b1754050042a87e17fbb2352c3b500da8f5bec0f/src/index.ts#L166-L197
[config]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/config.rs#L48-L79
[compose]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/docker/docker-compose.yml#L26-L28
[runbk]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/docker-build/run_backend.sh#L55-L64
[auth-rs]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/common/src/auth.rs#L209-L240
[authn]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/authentication/src/lib.rs#L439-L480
[lb-lib]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/lib.rs#L218-L232
[ne-rs]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/node_executor/src/executor.rs#L253
[ne-ts]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/node-executor/src/syscalls.ts#L325
[fs]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/file_storage/src/core.rs#L118-L180
[udf-env]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/udf/src/environment.rs#L71-L84
[djwt]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/udf/src/deployment_jwt.rs#L45-L60
[canon]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/canonical_urls.rs#L39-L110
[router]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/router.rs#L306-L392
[dash-canon]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/npm-packages/dashboard/src/hooks/deploymentApi.ts#L155
[reqdest]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/common/src/http/mod.rs#L825-L830
[subs]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/subs/mod.rs#L424-L480
[worker]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/sync/src/worker.rs#L857-L930
[authn-hdr]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/local_backend/src/authentication.rs#L55-L80
[ba-cfg]: https://github.com/get-convex/better-auth/blob/3f41cbcfbdb26141969d31e10a0199988ec3cf37/src/auth-config.ts#L75-L80
[ba-plugin]: https://github.com/get-convex/better-auth/blob/3f41cbcfbdb26141969d31e10a0199988ec3cf37/src/plugins/convex/index.ts#L182-L191
[ba-rs]: https://github.com/get-convex/better-auth/blob/3f41cbcfbdb26141969d31e10a0199988ec3cf37/src/react-start/index.ts#L53
[helpers]: https://github.com/get-convex/convex-helpers/blob/c248fba242be4181f252a13d75b8c5a9f9363b9a/packages/convex-helpers/README.md#L220-L275
