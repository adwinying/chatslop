// Browsers reach Convex only through this route (ADR 0001). Only the sync
// socket and file storage pass; the admin API on :3210 stays unreachable.
// The route sits under /convex/api so it never shadows the dev server's
// /convex/* source modules (convex/_generated/api.js and friends).
import { createWebSocketProxy } from "crossws";
import { defineHandler, defineWebSocketHandler, HTTPError } from "nitro";
import { proxy } from "nitro/h3";

const upstream = "127.0.0.1:3210";
const SYNC = /^\/api\/\d+\.\d+\.\d+\/sync$/;
const STORAGE = /^\/api\/storage\//;

const upstreamPath = (url: URL) => url.pathname.slice("/convex".length) + url.search;

const sync = createWebSocketProxy({
  target: (peer) => `ws://${upstream}${upstreamPath(new URL(peer.request.url))}`,
  // Compression on the loopback leg only costs CPU.
  webSocketOptions: { perMessageDeflate: false },
});

export default defineWebSocketHandler(
  {
    ...sync,
    upgrade(request) {
      if (!SYNC.test(new URL(request.url).pathname.slice("/convex".length))) {
        throw new Response("Not found", { status: 404 });
      }
      return sync.upgrade?.(request);
    },
  },
  defineHandler((event) => {
    if (!STORAGE.test(event.url.pathname.slice("/convex".length))) {
      throw new HTTPError("Not found", { status: 404 });
    }
    return proxy(event, `http://${upstream}${upstreamPath(event.url)}`);
  }),
);
