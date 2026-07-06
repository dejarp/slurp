import { Args, Command, Options } from "@effect/cli"
import { Engine } from "@slurp/core"
import { csvRenderer } from "@slurp/renderer-csv"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { buildMainLayer } from "./MainLive.js"

const renderers = { csv: csvRenderer }

export const runCommand = Command.make(
  "run",
  {
    repo: Args.text({ name: "repo" }).pipe(Args.withDefault(".")),
    output: Options.text("output").pipe(
      Options.withAlias("o"),
      Options.withDefault("./slurp-stats.json")
    ),
    concurrency: Options.integer("concurrency").pipe(
      Options.withAlias("c"),
      Options.withDefault(4)
    ),
    plugin: Options.text("plugin").pipe(Options.repeated),
    processMerges: Options.boolean("process-merges"),
    dryRun: Options.boolean("dry-run")
  },
  (config) =>
    Effect.gen(function*() {
      const engine = yield* Engine
      yield* engine.run({
        repoPath: config.repo,
        outputPath: config.output,
        maxConcurrency: config.concurrency,
        processMerges: config.processMerges,
        dryRun: config.dryRun,
        pluginFilter: config.plugin.length > 0
          ? Option.some(config.plugin)
          : Option.none()
      })
    }).pipe(Effect.provide(buildMainLayer(config.repo)))
).pipe(
  Command.withDescription("Run analysis plugins over git commit history")
)

export const renderCommand = Command.make(
  "render",
  {
    input: Options.text("input").pipe(Options.withAlias("i")),
    output: Options.text("output").pipe(Options.withAlias("o")),
    format: Options.choice("format", ["csv"] as const)
  },
  (config) =>
    Effect.gen(function*() {
      yield* renderers[config.format].render({
        input: config.input,
        output: config.output
      })
    })
).pipe(
  Command.withDescription("Render stats file to output format")
)

export const rootCommand = Command.make("slurp").pipe(
  Command.withSubcommands([runCommand, renderCommand])
)
