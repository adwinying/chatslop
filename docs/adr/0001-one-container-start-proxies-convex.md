# One container, with Start proxying Convex

The Convex backend and the TanStack Start server ship as one image built on `ghcr.io/convex/convex-backend`, with an entrypoint that deploys functions at boot. The browser never reaches port 3210 directly: Start forwards `/convex` (sync websocket and storage) through a Nitro crossws route, and the Convex origins stay on loopback, so Better Auth's issuer and JWKS never hairpin. This keeps the deployment to one service and one hostname on a LAN-only box. The cost is a custom entrypoint and proxy that nobody else has built ([Convex backend and TanStack Start in one container](https://github.com/adwinying/chatslop/issues/3), [Packaging and deployment](https://github.com/adwinying/chatslop/issues/9)).

## Consequences

- The `convex` npm package and the backend image tag must be upgraded together, with `convex export` run first. Upgrades migrate in place and can't be rolled back.
- If the Nitro proxy fails, the fallback is Caddy inside the container, not exposing 3210.
