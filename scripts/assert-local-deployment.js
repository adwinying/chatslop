// `pnpm seed` pushes dev.env: a public BETTER_AUTH_SECRET and a known Admin
// password. Refuse any target but a local deployment. A deploy key or a
// self-hosted URL overrides CONVEX_DEPLOYMENT in the Convex CLI, so refuse those too.
const {
  CONVEX_DEPLOYMENT = '',
  CONVEX_DEPLOY_KEY,
  CONVEX_SELF_HOSTED_URL,
} = process.env

if (
  !/^(local|anonymous):/.test(CONVEX_DEPLOYMENT) ||
  CONVEX_DEPLOY_KEY ||
  CONVEX_SELF_HOSTED_URL
) {
  console.error(
    `Refusing to seed CONVEX_DEPLOYMENT="${CONVEX_DEPLOYMENT}": pnpm seed only targets local deployments.`,
  )
  process.exit(1)
}
