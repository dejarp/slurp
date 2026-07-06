import * as Schema from "effect/Schema"

export class CommitInfo extends Schema.Class<CommitInfo>("CommitInfo")({
  sha: Schema.String,
  abbreviatedSha: Schema.String,
  parents: Schema.Array(Schema.String),
  authorName: Schema.String,
  authorEmail: Schema.String,
  authorDate: Schema.String,
  commitDate: Schema.String,
  subject: Schema.String,
  message: Schema.String
}) {}
