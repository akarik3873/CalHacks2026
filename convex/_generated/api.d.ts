/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as chat from "../chat.js";
import type * as creao from "../creao.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as lib_cortex from "../lib/cortex.js";
import type * as lib_creao from "../lib/creao.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_jina from "../lib/jina.js";
import type * as lib_telegram from "../lib/telegram.js";
import type * as lib_tools from "../lib/tools.js";
import type * as pipeline from "../pipeline.js";
import type * as telegram from "../telegram.js";
import type * as voice from "../voice.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  chat: typeof chat;
  creao: typeof creao;
  crons: typeof crons;
  http: typeof http;
  "lib/cortex": typeof lib_cortex;
  "lib/creao": typeof lib_creao;
  "lib/env": typeof lib_env;
  "lib/jina": typeof lib_jina;
  "lib/telegram": typeof lib_telegram;
  "lib/tools": typeof lib_tools;
  pipeline: typeof pipeline;
  telegram: typeof telegram;
  voice: typeof voice;
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

export declare const components: {};
