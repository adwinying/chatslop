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
import type * as attachments from "../attachments.js";
import type * as auth from "../auth.js";
import type * as cascade from "../cascade.js";
import type * as context from "../context.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as intake from "../intake.js";
import type * as listing from "../listing.js";
import type * as liveAnswers from "../liveAnswers.js";
import type * as llm from "../llm.js";
import type * as modelSync from "../modelSync.js";
import type * as models from "../models.js";
import type * as parts from "../parts.js";
import type * as providers from "../providers.js";
import type * as reasoning from "../reasoning.js";
import type * as search from "../search.js";
import type * as searchText from "../searchText.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as threads from "../threads.js";
import type * as titles from "../titles.js";
import type * as userSettings from "../userSettings.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  answer: typeof answer;
  attachments: typeof attachments;
  auth: typeof auth;
  cascade: typeof cascade;
  context: typeof context;
  crons: typeof crons;
  http: typeof http;
  intake: typeof intake;
  listing: typeof listing;
  liveAnswers: typeof liveAnswers;
  llm: typeof llm;
  modelSync: typeof modelSync;
  models: typeof models;
  parts: typeof parts;
  providers: typeof providers;
  reasoning: typeof reasoning;
  search: typeof search;
  searchText: typeof searchText;
  seed: typeof seed;
  settings: typeof settings;
  threads: typeof threads;
  titles: typeof titles;
  userSettings: typeof userSettings;
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
