import * as Schema from "effect/Schema"
import { CommitStats } from "./CommitStats.js"

const RepoInfo = Schema.Struct({
  path: Schema.String,
  head: Schema.String
})

const PluginInfo = Schema.Struct({
  name: Schema.String,
  version: Schema.String
})

export class StatsFile extends Schema.Class<StatsFile>("StatsFile")({
  version: Schema.String,
  slurpVersion: Schema.String,
  repo: RepoInfo,
  plugins: Schema.Array(PluginInfo),
  commits: Schema.Array(CommitStats)
}) {}
