import * as Schema from "effect/Schema"

export class PluginError extends Schema.TaggedError<PluginError>()("PluginError", {
  pluginName: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}
