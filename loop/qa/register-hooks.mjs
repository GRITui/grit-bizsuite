// Registers QA-harness resolve hooks (see lib/stub-server-only.mjs).
// Used via: node --experimental-strip-types --import ./loop/qa/register-hooks.mjs ...
import { registerHooks } from "node:module";
import { hooks } from "./lib/stub-server-only.mjs";

registerHooks(hooks);
