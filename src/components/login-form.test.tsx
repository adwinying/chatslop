import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { LoginForm } from "~/components/login-form";
import { authClient } from "~/lib/auth-client";

vi.mock("~/lib/auth-client", () => ({
  authClient: {
    signIn: {
      email: vi.fn<() => Promise<unknown>>(),
      username: vi.fn<() => Promise<unknown>>(),
    },
  },
}));

const ok = { data: {}, error: null };
const rejected = { data: null, error: { status: 401, message: "Invalid" } };

function logIn(identifier: string, password = "pw") {
  const onSuccess = vi.fn<() => void>();
  render(<LoginForm onSuccess={onSuccess} />);
  fireEvent.change(screen.getByLabelText("Username or email"), {
    target: { value: identifier },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.click(screen.getByRole("button", { name: "Log in" }));
  return onSuccess;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("LoginForm", () => {
  test("signs in by username", async () => {
    vi.mocked(authClient.signIn.username).mockResolvedValue(ok);

    const onSuccess = logIn("adwin");

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(authClient.signIn.username).toHaveBeenCalledWith({
      username: "adwin",
      password: "pw",
    });
  });

  test("signs in by email when the identifier has an @", async () => {
    vi.mocked(authClient.signIn.email).mockResolvedValue(ok);

    const onSuccess = logIn(" adwin@example.com ");

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(authClient.signIn.email).toHaveBeenCalledWith({
      email: "adwin@example.com",
      password: "pw",
    });
  });

  test("shows an error and stays put when the credentials are wrong", async () => {
    vi.mocked(authClient.signIn.username).mockResolvedValue(rejected);

    const onSuccess = logIn("adwin", "wrong");

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Wrong username, email or password",
    );
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
