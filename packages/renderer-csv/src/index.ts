import * as FileSystem from "@effect/platform/FileSystem"
import { StatsFile } from "@slurp/core"
import { RenderError } from "@slurp/core"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export interface RenderOptions {
  readonly input: string
  readonly output: string
}

const csvEscape = (value: string): string => {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replaceAll("\"", "\"\"")}"`
  }
  return value
}

const renderCsv = (stats: StatsFile): string => {
  const pluginNames = new Set<string>()
  for (const commit of stats.commits) {
    for (const pluginName of Object.keys(commit.results as Record<string, unknown>)) {
      pluginNames.add(pluginName)
    }
  }
  const pluginColumns = Array.from(pluginNames).sort()

  const headers = [
    "sha",
    "abbreviatedSha",
    "authorDate",
    "authorName",
    "subject",
    ...pluginColumns
  ]

  const rows = stats.commits.map((commit) => {
    const results = commit.results as Record<string, unknown>
    const base = [
      csvEscape(commit.sha),
      csvEscape(commit.abbreviatedSha),
      csvEscape(commit.authorDate),
      csvEscape(commit.authorName),
      csvEscape(commit.subject)
    ]
    const pluginCells = pluginColumns.map((name) =>
      results[name] !== undefined ? csvEscape(JSON.stringify(results[name])) : ""
    )
    return [...base, ...pluginCells].join(",")
  })

  return [headers.join(","), ...rows].join("\n") + "\n"
}

export const render = (options: RenderOptions): Effect.Effect<void, RenderError, FileSystem.FileSystem> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem

    const content = yield* fs.readFileString(options.input).pipe(
      Effect.mapError((err) =>
        new RenderError({
          format: "csv",
          message: `Failed to read input file: ${err.message}`
        })
      )
    )

    const json = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: (err) =>
        new RenderError({
          format: "csv",
          message: `Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`
        })
    })

    const stats = yield* Schema.decodeUnknown(StatsFile)(json).pipe(
      Effect.mapError((err) =>
        new RenderError({
          format: "csv",
          message: `Schema validation failed: ${err.message}`
        })
      )
    )

    const csv = renderCsv(stats)

    yield* fs.writeFileString(options.output, csv).pipe(
      Effect.mapError((err) =>
        new RenderError({
          format: "csv",
          message: `Failed to write output file: ${err.message}`
        })
      )
    )
  })

export const csvRenderer = { render }
