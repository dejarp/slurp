import * as Schema from "effect/Schema"

export class RenderError extends Schema.TaggedError<RenderError>()("RenderError", {
  format: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}
