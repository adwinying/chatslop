import { createRouter } from "@tanstack/react-router";
import { ConvexReactClient } from "convex/react";
import { convexUrl } from "~/lib/convex-url";
import { routeTree } from "~/routeTree.gen";

export function getRouter() {
  // expectAuth holds every Convex call until the token lands, so the shell
  // never runs a query signed out. Sign-out therefore reloads the page.
  const convex = new ConvexReactClient(convexUrl(), { expectAuth: true });

  return createRouter({
    routeTree,
    context: { convex },
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
