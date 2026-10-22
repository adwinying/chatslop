/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as answer from "../answer.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as listing from "../listing.js";
import type * as liveAnswers from "../liveAnswers.js";
import type * as llm from "../llm.js";
import type * as modelSync from "../modelSync.js";
import type * as models from "../models.js";
import type * as parts from "../parts.js";
import type * as providers from "../providers.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as threads from "../threads.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  answer: typeof answer;
  auth: typeof auth;
  crons: typeof crons;
  http: typeof http;
  listing: typeof listing;
  liveAnswers: typeof liveAnswers;
  llm: typeof llm;
  modelSync: typeof modelSync;
  models: typeof models;
  parts: typeof parts;
  providers: typeof providers;
  seed: typeof seed;
  settings: typeof settings;
  threads: typeof threads;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@/convex/betterAuth/_generated/component.js").ComponentApi<"betterAuth">;
};
