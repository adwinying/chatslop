# Better Auth on self-hosted Convex

Ticket: #4. Researched 2026-10-21 against `@convex-dev/better-auth` `0.12.5` (`3f41cbc`, 2026-10-16), Better Auth `v1.6.15`, and convex-backend `95d8719`. Layout assumed from #3: one container, browser talks to Convex at `https://api.<domain>` (port 3210, HTTP actions under `/http`), Start app at `https://<domain>` (port 3000).

## Answer

Yes. The Convex component supports self-hosted Convex. Upstream says "Self hosted is fully supported" ([#82][i82]), and every framework guide has a self-hosted tab ([tanstack-start.mdx][ts-guide]). Username + password login works out of the box. The admin plugin needs the component's **Local Install** because the shipped schema lacks its fields. With `disableSignUp: true`, Admins can still create users. A server-side `auth.api.createUser` call without headers skips the session check, so the first Admin can be seeded from an internal Convex function at boot.

Two hostnames cause no cookie problems: all auth traffic goes through the Start app, and the Convex WebSocket authenticates with a JWT, not a cookie. One self-host specific risk is the backend fetching its own public JWKS URL. Static JWKS removes that fetch.

## Findings

### How it fits together

- Better Auth runs **inside Convex** as HTTP actions: `authComponent.registerRoutes(http, createAuth)` in `convex/http.ts`. Its tables live in the component, not the app schema ([tanstack-start.mdx][ts-guide], [#69][i69]).
- The Start app mounts `src/routes/api/auth/$.ts` and forwards `GET`/`POST` to `convexSiteUrl` with `handler` from `convexBetterAuthReactStart` ([tanstack-start.mdx][ts-guide]). The proxy sets `x-better-auth-forwarded-host/proto` to the app host. The component restores them before Better Auth sees the request ([react-start/index.ts][rs-src], [create-client.ts][cc-src]).
- The `convex()` plugin adds Better Auth's `jwt` and `bearer` plugins. It issues RS256 JWTs with `iss = process.env.CONVEX_SITE_URL`, `aud = "convex"`, a 15 min default TTL, and `sessionId` in the payload ([plugins/convex/index.ts][plugin-src]).
- `convex/auth.config.ts` registers a Convex `customJwt` provider: issuer `CONVEX_SITE_URL`, JWKS `${CONVEX_SITE_URL}/api/auth/convex/jwks` ([auth-config.ts][authcfg-src]).
- Version pins: the component peer-depends on `better-auth >=1.6.11 <1.7.0` and `convex ^1.25.0`, and the guide installs `better-auth@~1.6.15` ([package.json][pkg]). Better Auth `main` is already at 1.7.x, so **stay on 1.6** until the component moves.

### Self-hosted Convex: URLs, issuer, cookies

- No cloud-only assumption in code. The component reads `CONVEX_SITE_URL`, which a self-hosted backend derives from `CONVEX_SITE_ORIGIN` ([fly README][fly]). The only cloud check rejects a `convexSiteUrl` ending in `.convex.cloud` ([react-start/index.ts][rs-src]).
- With #3's layout, `CONVEX_SITE_ORIGIN=https://api.<domain>/http`, so issuer = `https://api.<domain>/http` and JWKS = `https://api.<domain>/http/api/auth/convex/jwks`. The backend nests HTTP actions under `/http/` and gives the action the stripped path ([router.rs][router], [config.rs][config], [http_actions.rs][httpact]), so Better Auth sees `/api/auth/...` and routes normally.
- **Convex env** (in the backend DB, set with `convex env set`): `BETTER_AUTH_SECRET`, `SITE_URL=https://<domain>` (Better Auth `baseURL`) ([tanstack-start.mdx][ts-guide]).
- **Start env**: `VITE_CONVEX_URL=https://api.<domain>` (browser, inlined at build). `convexSiteUrl` in `auth-server.ts` is only used server-side, for the proxy and `getToken` ([react-start/index.ts][rs-src]). Inside the container it can be `http://127.0.0.1:3210/http`, avoiding a hairpin. `fetchAuth*`'s `convexUrl` can likewise be `http://127.0.0.1:3210`.
- **Cookies**: Better Auth session cookies and the `convex_jwt` SSR cookie are set by responses proxied through `https://<domain>/api/auth/*`, so they live on the app host only ([plugins/convex/index.ts][plugin-src]). The browser gets a JWT from `/api/auth/convex/token` (same origin) and passes it to the Convex client ([react/index.tsx][react-src]). `api.<domain>` never needs cookies or CORS for auth. No `crossDomain` plugin, no shared parent-domain cookie.
- **Pitfall (JWKS hairpin):** Convex validates JWTs by fetching the JWKS URL. Token validation over HTTP is never cached ([experimental.mdx][exp]). Here that means the backend fetching `https://api.<domain>/http/...` from inside the container through the reverse proxy. If hairpin DNS/NAT fails, every authenticated call fails. Fix: **Static JWKS**. Run `auth.api.getLatestJwks()` once, store it as Convex env `JWKS`, and pass it to both `getAuthConfigProvider({ jwks })` and `convex({ jwks })` ([experimental.mdx][exp], [auth-config.ts][authcfg-src]). It is marked experimental. The value holds the private key, so treat it as a secret. Bootstrapping needs deploy, `convex run auth:getLatestJwks | convex env set JWKS`, then deploy again so `auth.config.ts` picks it up (untested order).
- Older reports of self-hosted failures came down to a wrong site URL/port ([#52][i52]).

### Disabling signup, Admin-only creation

- `emailAndPassword.disableSignUp: true` makes `/sign-up/email` throw `EMAIL_PASSWORD_SIGN_UP_DISABLED` ([sign-up.ts][signup]).
- Admin `createUser` writes through `internalAdapter` and never checks `disableSignUp` ([routes.ts#createUser][r-create]). So public signup off + Admin creation works.
- `createUser` requires a valid email (`z.email()`) ([routes.ts#createUser][r-create]). Users who log in by username still need an email. Use a real one or a placeholder such as `<username>@users.invalid`.

### Username login

- The username plugin is on the component's supported list. The shipped schema has `username`, `displayUsername`, and a `username` index ([supported-plugins.mdx][supported], [component schema][schema]).
- Login: `authClient.signIn.username({ username, password })` → `/sign-in/username`. Email login stays available via `signIn.email` ([username.mdx][username]).
- Admin `createUser` with `data: { username }` normalizes the username, checks for duplicates, and fills `displayUsername` ([admin-username.test.ts][admin-username]).

### Admin plugin coverage

| chatslop action | Better Auth call | Notes |
| --- | --- | --- |
| Create | `admin.createUser({ email, password, name, role?, data: { username } })` | Works with signup disabled. |
| Reset password | `admin.setUserPassword({ userId, newPassword })` | Enforces min/max length. Does **not** revoke sessions, so follow with `admin.revokeUserSessions` if wanted ([routes.ts][r-setpw]). |
| Disable | `admin.banUser({ userId, banReason? })` (no `banExpiresIn` = permanent), `unbanUser` to re-enable | Deletes the user's sessions. A `session.create` hook blocks new sign-ins with `bannedUserMessage` ([routes.ts][r-ban], [admin.ts][admin-ts]). |
| Delete | `admin.removeUser({ userId })` | Deletes sessions, accounts, then the user. Admins cannot remove themselves ([routes.ts][r-remove], [internal-adapter.ts][ia]). Threads are app data; delete them in the same transaction with a component `onDelete` trigger on `user` ([triggers.mdx][triggers]). |
| Promote | `admin.setRole({ userId, role: "admin" })` | Roles: `admin`, `user` by default ([admin.mdx][admin-doc]). |

- Schema: adds `user.role`, `user.banned`, `user.banReason`, `user.banExpires`, `session.impersonatedBy` ([admin.mdx][admin-doc]). The component's default schema omits them on purpose. Maintainers closed a PR adding them and pointed to Local Install ([#285][i285], [#286][i286]).
- **Local Install**: `convex/betterAuth/convex.config.ts` (`defineComponent("betterAuth")`), generate `schema.ts` with `npx auth generate`, split out `createAuthOptions`, export the adapter via `createApi(schema, createAuthOptions)`, and pass `{ local: { schema } }` to `createClient` ([local-install.mdx][local]). Regenerate the schema when plugins change.
- Admin calls run in Convex: wrap `auth.api.*` in a mutation/action using `authComponent.getAuth(createAuth, ctx)` for `headers` ([tanstack-start.mdx][ts-guide]), or call `authClient.admin.*` from the browser through the proxy.

### Seeding the first Admin

Options, from the sources above:

1. **Recommended:** an `internalAction` such as `seed:firstAdmin`. It reads `ADMIN_EMAIL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, returns if any user with `role = "admin"` exists, and otherwise calls `createAuth(ctx).api.createUser({ body: { ..., role: "admin" } })` **without headers**. With no request or headers, `createUser` skips the session/permission check ([routes.ts#createUser][r-create]). Run it from #3's entrypoint after `convex deploy`: `npx convex run seed:firstAdmin` (Local Install lets the function query `user` directly ([local-install.mdx][local])). Upstream suggests the same approach: "run any Convex function with the cli" + admin plugin ([#69][i69]). Prefer an action over a mutation: hashing is CPU-heavy and mutations have tighter limits (inference, not from the sources).
2. `databaseHooks.user.create.before` that sets `role: "admin"` when the email matches an env var. Better Auth's own test uses this pattern ([admin-username.test.ts][admin-username]). It still needs something to create the user, so it only adds indirection here.
3. `admin({ adminUserIds: [...] })` ([admin.mdx][admin-doc]). Needs the ID before the user exists. Poor fit.

Convex env vars live in the backend DB, so the entrypoint must `convex env set` them from container env first (#3).

### Sessions in Convex functions

- `ctx.auth.getUserIdentity()` returns JWT claims (`subject` = user ID, `sessionId`). It does **not** check that the session still exists ([authorization.mdx][authz]).
- `authComponent.getAuthUser(ctx)` / `safeGetAuthUser(ctx)` look up the session by `sessionId` and `expiresAt`, then the user ([create-client.ts][cc-src]). Use it as the gate. Ban/delete/revoke then take effect immediately instead of after the JWT's 15 min, and queries re-run reactively when the session row disappears.
- Check `user.role === "admin"` from that user row, not from the JWT. The JWT holds no role unless you add one with `jwt.definePayload`, and a JWT role would be stale until expiry ([plugins/convex/index.ts][plugin-src]).
- Client: gate UI with Convex's `<Authenticated>` / `useConvexAuth()`, not Better Auth's `useSession()`. Better Auth reports a user before Convex has validated the token ([authorization.mdx][authz]).

### SSR with TanStack Start

- Setup from the guide ([tanstack-start.mdx][ts-guide]):
  - `ssr.noExternal: ['@convex-dev/better-auth']` in Vite.
  - Root `beforeLoad` calls a `createServerFn` wrapping `getToken()` and runs `convexQueryClient.serverHttpClient?.setAuth(token)`.
  - The root component wraps the app in `<ConvexBetterAuthProvider client authClient initialToken>`.
  - `new ConvexQueryClient(url, { expectAuth: true })`, plus `setupRouterSsrQueryIntegration`.
- Loaders use `queryClient.ensureQueryData(convexQuery(...))` and components `useSuspenseQuery`. Server functions use `fetchAuthQuery/Mutation/Action` ([tanstack-start.mdx][ts-guide]). Route handlers use the `server.handlers` shape ([TanStack server routes][start-routes]).
- `getToken` costs one extra request per SSR. The experimental `jwtCache` reuses the `convex_jwt` cookie ([experimental.mdx][exp]).

### Known limitations

- **`expectAuth: true`** blocks every Convex call until auth. After sign-out then sign-in without a reload, queries fire before auth is ready. The guide's fix: `location.reload()` on sign-out ([tanstack-start.mdx][ts-guide]). The login page must not depend on Convex queries.
- `auth.api.*` must run inside Convex functions, not in Start server code ([tanstack-start.mdx][ts-guide]).
- Local Install's `convex/betterAuth/auth.ts` must hold only the static `auth` export for the CLI. Importing it at runtime errors on missing env ([local-install.mdx][local]).
- Queries without a matching index log a warning. Add custom indexes through a generated-schema split ([local-install.mdx][local]).
- Triggers run in the same transaction as one DB operation, but a multi-write endpoint can partially commit ([triggers.mdx][triggers]).
- Default JWKS URL fetch on every HTTP-client call (SSR, `fetchAuth*`). Static JWKS is experimental ([experimental.mdx][exp]).
- Incompatible plugin: SSO (Node deps). Not needed here ([supported-plugins.mdx][supported]).

## Open questions for a spike

- Does the backend reach `https://api.<domain>/http/...` from inside the container? If not, Static JWKS is required, not optional.
- Does a changed `JWKS` env var reach `auth.config.ts` without a redeploy?
- Password hashing latency in the Convex runtime on the target server.

[ts-guide]: https://github.com/get-convex/better-auth/blob/3f41cbc/docs/content/docs/framework-guides/tanstack-start.mdx
[supported]: https://github.com/get-convex/better-auth/blob/3f41cbc/docs/content/docs/supported-plugins.mdx
[local]: https://github.com/get-convex/better-auth/blob/3f41cbc/docs/content/docs/features/local-install.mdx
[authz]: https://github.com/get-convex/better-auth/blob/3f41cbc/docs/content/docs/basic-usage/authorization.mdx
[exp]: https://github.com/get-convex/better-auth/blob/3f41cbc/docs/content/docs/experimental.mdx
[triggers]: https://github.com/get-convex/better-auth/blob/3f41cbc/docs/content/docs/features/triggers.mdx
[pkg]: https://github.com/get-convex/better-auth/blob/3f41cbc/package.json
[schema]: https://github.com/get-convex/better-auth/blob/3f41cbc/src/component/schema.ts#L25-L34
[authcfg-src]: https://github.com/get-convex/better-auth/blob/3f41cbc/src/auth-config.ts
[plugin-src]: https://github.com/get-convex/better-auth/blob/3f41cbc/src/plugins/convex/index.ts
[rs-src]: https://github.com/get-convex/better-auth/blob/3f41cbc/src/react-start/index.ts
[react-src]: https://github.com/get-convex/better-auth/blob/3f41cbc/src/react/index.tsx#L129-L145
[cc-src]: https://github.com/get-convex/better-auth/blob/3f41cbc/src/client/create-client.ts#L88-L190
[i52]: https://github.com/get-convex/better-auth/issues/52
[i69]: https://github.com/get-convex/better-auth/issues/69
[i82]: https://github.com/get-convex/better-auth/issues/82
[i285]: https://github.com/get-convex/better-auth/issues/285
[i286]: https://github.com/get-convex/better-auth/pull/286
[admin-doc]: https://github.com/better-auth/better-auth/blob/v1.6.15/docs/content/docs/plugins/admin.mdx
[username]: https://github.com/better-auth/better-auth/blob/v1.6.15/docs/content/docs/plugins/username.mdx
[signup]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/api/routes/sign-up.ts#L182-L191
[r-create]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/plugins/admin/routes.ts#L293-L403
[r-ban]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/plugins/admin/routes.ts#L931-L1012
[r-remove]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/plugins/admin/routes.ts#L1421-L1491
[r-setpw]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/plugins/admin/routes.ts#L1518-L1582
[admin-ts]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/plugins/admin/admin.ts#L90-L120
[admin-username]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/plugins/admin/admin-username.test.ts
[ia]: https://github.com/better-auth/better-auth/blob/v1.6.15/packages/better-auth/src/db/internal-adapter.ts#L282-L310
[fly]: https://github.com/get-convex/convex-backend/blob/95d8719/self-hosted/advanced/fly/README.md
[config]: https://github.com/get-convex/convex-backend/blob/95d8719/crates/local_backend/src/config.rs#L60-L72
[router]: https://github.com/get-convex/convex-backend/blob/95d8719/crates/local_backend/src/router.rs#L417
[httpact]: https://github.com/get-convex/convex-backend/blob/95d8719/crates/local_backend/src/http_actions.rs#L116-L129
[start-routes]: https://tanstack.com/start/latest/docs/framework/react/guide/server-routes
