import { useQuery } from "convex/react";
import { LogOutIcon } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";

export function AppSidebar() {
  return (
    <aside className="hidden w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="px-3 pt-4 pb-2 text-center font-semibold tracking-tight">chatslop</div>
      <div className="px-3">
        <Button className="w-full" size="lg">
          New Chat
        </Button>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2" />
      <UserFooter />
    </aside>
  );
}

// expectAuth makes a plain reload the only safe way back to signed out.
async function signOut() {
  await authClient.signOut();
  location.reload();
}

function UserFooter() {
  const me = useQuery(api.users.me);

  return (
    <div className="flex items-center gap-2 border-t border-sidebar-border p-3 text-sm">
      <div className="grid size-8 place-items-center rounded-full bg-brand-600 font-semibold uppercase">
        {me?.name.charAt(0)}
      </div>
      <div className="leading-tight">
        <div>{me?.name}</div>
        <div className="text-xs text-muted-foreground">
          {me && (me.role === "admin" ? "Admin" : "User")}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto"
        aria-label="Log out"
        onClick={signOut}
      >
        <LogOutIcon />
      </Button>
    </div>
  );
}
