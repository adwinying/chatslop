import { query } from "./_generated/server";
import { authComponent } from "./auth";

/** The signed-in User, for the sidebar footer. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    return { name: user.name, username: user.username ?? null, role: user.role ?? "user" };
  },
});
