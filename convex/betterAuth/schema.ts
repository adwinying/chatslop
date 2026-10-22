import { defineSchema } from "convex/server"
import { tables } from "@/convex/betterAuth/generatedSchema"

export default defineSchema({
  ...tables,
  // The first-Admin seed looks up Admins by role.
  user: tables.user.index("role", ["role"]),
})
