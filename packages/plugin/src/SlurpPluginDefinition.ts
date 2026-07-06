import type * as Effect from "effect/Effect"
import type * as Schema from "effect/Schema"
import type { AnalyzeContext } from "./AnalyzeContext.js"
import type { PluginError } from "./PluginError.js"

export interface SlurpPluginDefinition {
  readonly name: string
  readonly version: string
  readonly analyze: (ctx: AnalyzeContext) => Effect.Effect<unknown, PluginError>
  readonly resultSchema?: Schema.Schema<unknown, unknown, unknown>
}

export const definePlugin = (def: SlurpPluginDefinition): SlurpPluginDefinition => def
