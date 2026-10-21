import { query } from "./_generated/server";
import { authComponent } from "./auth";

/** The signed-in User, for the sidebar footer. Null once the session ends, e.g. mid sign-out. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.safeGetAuthUser(ctx);
    if (!user) return null;
    return { name: user.name, username: user.username ?? null, role: user.role ?? "user" };
  },
});
