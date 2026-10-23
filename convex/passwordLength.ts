// No server imports, so the /admin password inputs can apply the same limits.

/** Better Auth's password length limits, as auth.ts configures them. */
export const PASSWORD_LENGTH = { minLength: 8, maxLength: 128 }
