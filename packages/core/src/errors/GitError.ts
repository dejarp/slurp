import * as Schema from "effect/Schema"

export class GitError extends Schema.TaggedError<GitError>()("GitError", {
  command: Schema.String,
  message: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  stderr: Schema.optional(Schema.String)
}) {}
