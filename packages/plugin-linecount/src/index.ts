import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { type AnalyzeContext, definePlugin } from "@slurp/plugin"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export class LinecountResult extends Schema.Class<LinecountResult>("LinecountResult")({
  totalLines: Schema.Number,
  byExtension: Schema.Record({ key: Schema.String, value: Schema.Number })
}) {}

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".svg",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".bz2",
  ".7z",
  ".rar",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp3",
  ".mp4",
  ".avi",
  ".mov",
  ".wav",
  ".flv",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".dat",
  ".class",
  ".jar",
  ".wasm",
  ".sqlite",
  ".db"
])

const shouldSkipPath = (relativePath: string): boolean =>
  relativePath.startsWith(".git/") ||
  relativePath === ".git" ||
  relativePath.startsWith("node_modules/")

const isLikelyBinary = (ext: string): boolean => BINARY_EXTENSIONS.has(ext)

const countLines = (content: string): number => content.split("\n").filter((line) => line.trim().length > 0).length

export default definePlugin({
  name: "linecount",
  version: "0.1.0",
  analyze: (ctx: AnalyzeContext) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const entries = yield* fs
        .readDirectory(ctx.worktreePath, { recursive: true })
        .pipe(Effect.catchAll(() => Effect.succeed([] as Array<string>)))

      let totalLines = 0
      const byExtension = new Map<string, number>()

      yield* Effect.forEach(
        entries,
        (entry) =>
          Effect.gen(function*() {
            if (shouldSkipPath(entry)) return

            const fullPath = path.join(ctx.worktreePath, entry)
            const ext = path.extname(entry).toLowerCase()

            if (ext === "") return
            if (isLikelyBinary(ext)) return

            const content = yield* fs
              .readFileString(fullPath)
              .pipe(Effect.catchAll(() => Effect.succeed(null)))

            if (content === null) return
            if (content.includes("\u0000")) return

            const lines = countLines(content)
            totalLines += lines
            byExtension.set(ext, (byExtension.get(ext) ?? 0) + lines)
          }),
        { concurrency: "unbounded" }
      )

      return {
        totalLines,
        byExtension: Object.fromEntries(byExtension)
      }
    }).pipe(Effect.provide(NodeContext.layer))
})
