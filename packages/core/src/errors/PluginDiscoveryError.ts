import * as Schema from "effect/Schema"

export class PluginDiscoveryError extends Schema.TaggedError<PluginDiscoveryError>()("PluginDiscoveryError", {
  packageName: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}
