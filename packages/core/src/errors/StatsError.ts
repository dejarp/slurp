import * as Schema from "effect/Schema"

export class StatsError extends Schema.TaggedError<StatsError>()("StatsError", {
  operation: Schema.Literal("load", "save", "decode"),
  path: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}
