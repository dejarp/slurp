import * as Schema from "effect/Schema"

export class EngineError extends Schema.TaggedError<EngineError>()("EngineError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}
