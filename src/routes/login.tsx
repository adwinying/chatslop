import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginForm } from "~/components/login-form";

export const Route = createFileRoute("/login")({
  beforeLoad: ({ context }) => {
    if (context.token) throw redirect({ to: "/" });
  },
  component: LoginPage,
});

function LoginPage() {
  const navigate = Route.useNavigate();
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm rounded-xl border bg-card p-6">
        <h1 className="mb-6 text-center text-xl font-semibold tracking-tight">
          chatslop
        </h1>
        <LoginForm onSuccess={() => navigate({ to: "/" })} />
      </div>
    </main>
  );
}
