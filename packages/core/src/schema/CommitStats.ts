import { CommitInfo } from "@slurp/plugin"
import * as Schema from "effect/Schema"

export class CommitStats extends CommitInfo.extend<CommitStats>("CommitStats")({
  patchId: Schema.NullOr(Schema.String),
  processedPlugins: Schema.Array(Schema.String),
  results: Schema.Record({ key: Schema.String, value: Schema.Unknown })
}) {}
