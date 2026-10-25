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
import type * as lib_cartesia from "../lib/cartesia.js";
import type * as lib_cortex from "../lib/cortex.js";
import type * as lib_creao from "../lib/creao.js";
import type * as lib_env from "../lib/env.js";
import type * as lib_jev from "../lib/jev.js";
import type * as lib_jina from "../lib/jina.js";
import type * as lib_shopping_airquality from "../lib/shopping/airquality.js";
import type * as lib_shopping_catalog from "../lib/shopping/catalog.js";
import type * as lib_shopping_data from "../lib/shopping/data.js";
import type * as lib_shopping_guardrails from "../lib/shopping/guardrails.js";
import type * as lib_shopping_intent from "../lib/shopping/intent.js";
import type * as lib_shopping_links from "../lib/shopping/links.js";
import type * as lib_shopping_messages from "../lib/shopping/messages.js";
import type * as lib_shopping_planner from "../lib/shopping/planner.js";
import type * as lib_shopping_understanding from "../lib/shopping/understanding.js";
import type * as lib_speech from "../lib/speech.js";
import type * as lib_telegram from "../lib/telegram.js";
import type * as lib_tools from "../lib/tools.js";
import type * as pipeline from "../pipeline.js";
import type * as shop from "../shop.js";
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
  "lib/cartesia": typeof lib_cartesia;
  "lib/cortex": typeof lib_cortex;
  "lib/creao": typeof lib_creao;
  "lib/env": typeof lib_env;
  "lib/jev": typeof lib_jev;
  "lib/jina": typeof lib_jina;
  "lib/shopping/airquality": typeof lib_shopping_airquality;
  "lib/shopping/catalog": typeof lib_shopping_catalog;
  "lib/shopping/data": typeof lib_shopping_data;
  "lib/shopping/guardrails": typeof lib_shopping_guardrails;
  "lib/shopping/intent": typeof lib_shopping_intent;
  "lib/shopping/links": typeof lib_shopping_links;
  "lib/shopping/messages": typeof lib_shopping_messages;
  "lib/shopping/planner": typeof lib_shopping_planner;
  "lib/shopping/understanding": typeof lib_shopping_understanding;
  "lib/speech": typeof lib_speech;
  "lib/telegram": typeof lib_telegram;
  "lib/tools": typeof lib_tools;
  pipeline: typeof pipeline;
  shop: typeof shop;
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

export declare const components: {
  staticHosting: import("@convex-dev/static-hosting/_generated/component.js").ComponentApi<"staticHosting">;
};
