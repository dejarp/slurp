import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { render } from "../src/index.js"

describe("renderer-csv", () => {
  it.effect("renders valid CSV from stats JSON", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-csv-test-" })
        const inputPath = path.join(tempDir, "stats.json")
        const outputPath = path.join(tempDir, "report.csv")

        const statsJson = {
          version: "1.0.0",
          slurpVersion: "0.1.0",
          repo: { path: "/repo", head: "abcdef" },
          plugins: [{ name: "linecount", version: "0.1.0" }],
          commits: [
            {
              sha: "sha1",
              abbreviatedSha: "sha1",
              parents: [],
              authorName: "Alice",
              authorEmail: "alice@test.com",
              authorDate: "2024-01-15T10:00:00Z",
              commitDate: "2024-01-15T10:00:00Z",
              subject: "First commit",
              message: "First commit",
              patchId: "pid1",
              processedPlugins: ["linecount"],
              results: { linecount: { totalLines: 42, byExtension: { ".ts": 42 } } }
            },
            {
              sha: "sha2",
              abbreviatedSha: "sha2",
              parents: ["sha1"],
              authorName: "Bob",
              authorEmail: "bob@test.com",
              authorDate: "2024-01-16T10:00:00Z",
              commitDate: "2024-01-16T10:00:00Z",
              subject: "Second commit",
              message: "Second commit",
              patchId: "pid2",
              processedPlugins: ["linecount"],
              results: { linecount: { totalLines: 100, byExtension: { ".ts": 60, ".js": 40 } } }
            }
          ]
        }

        yield* fs.writeFileString(inputPath, JSON.stringify(statsJson))

        yield* render({ input: inputPath, output: outputPath }).pipe(
          Effect.provide(NodeContext.layer)
        )

        const csv = yield* fs.readFileString(outputPath)
        const lines = csv.trim().split("\n")

        expect(lines).toHaveLength(3)

        const header = lines[0]!
        expect(header).toContain("sha")
        expect(header).toContain("author")
        expect(header).toContain("authorDate")
        expect(header).toContain("subject")
        expect(header).toContain("linecount")

        expect(lines[1]!).toContain("sha1")
        expect(lines[1]!).toContain("Alice")
        expect(lines[1]!).toContain("First commit")
        expect(lines[1]!).toContain("42")

        expect(lines[2]!).toContain("sha2")
        expect(lines[2]!).toContain("100")
      })
    ).pipe(Effect.provide(NodeContext.layer)), 15000)

  it.effect("handles empty commits array", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-csv-empty-" })
        const inputPath = path.join(tempDir, "stats.json")
        const outputPath = path.join(tempDir, "report.csv")

        const statsJson = {
          version: "1.0.0",
          slurpVersion: "0.1.0",
          repo: { path: "/repo", head: "abc" },
          plugins: [],
          commits: []
        }

        yield* fs.writeFileString(inputPath, JSON.stringify(statsJson))

        yield* render({ input: inputPath, output: outputPath }).pipe(
          Effect.provide(NodeContext.layer)
        )

        const csv = yield* fs.readFileString(outputPath)
        const lines = csv.trim().split("\n")

        expect(lines).toHaveLength(1)
        expect(lines[0]).toContain("sha")
      })
    ).pipe(Effect.provide(NodeContext.layer)), 15000)

  it.effect("handles commits with multiple plugins", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-csv-multi-" })
        const inputPath = path.join(tempDir, "stats.json")
        const outputPath = path.join(tempDir, "report.csv")

        const statsJson = {
          version: "1.0.0",
          slurpVersion: "0.1.0",
          repo: { path: "/repo", head: "abc" },
          plugins: [
            { name: "linecount", version: "0.1.0" },
            { name: "buildcheck", version: "0.1.0" }
          ],
          commits: [{
            sha: "sha1",
            abbreviatedSha: "sha1",
            parents: [],
            authorName: "Alice",
            authorEmail: "alice@test.com",
            authorDate: "2024-01-15T10:00:00Z",
            commitDate: "2024-01-15T10:00:00Z",
            subject: "First",
            message: "First",
            patchId: "pid1",
            processedPlugins: ["linecount", "buildcheck"],
            results: {
              linecount: { totalLines: 42 },
              buildcheck: { success: true }
            }
          }]
        }

        yield* fs.writeFileString(inputPath, JSON.stringify(statsJson))

        yield* render({ input: inputPath, output: outputPath }).pipe(
          Effect.provide(NodeContext.layer)
        )

        const csv = yield* fs.readFileString(outputPath)
        const header = csv.trim().split("\n")[0]!

        expect(header).toContain("linecount")
        expect(header).toContain("buildcheck")
      })
    ).pipe(Effect.provide(NodeContext.layer)), 15000)

  it.effect("CSV escaping handles commas and quotes in fields", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-csv-esc-" })
        const inputPath = path.join(tempDir, "stats.json")
        const outputPath = path.join(tempDir, "report.csv")

        const statsJson = {
          version: "1.0.0",
          slurpVersion: "0.1.0",
          repo: { path: "/repo", head: "abc" },
          plugins: [{ name: "linecount", version: "0.1.0" }],
          commits: [{
            sha: "sha1",
            abbreviatedSha: "sha1",
            parents: [],
            authorName: "Alice, Jr.",
            authorEmail: "alice@test.com",
            authorDate: "2024-01-15T10:00:00Z",
            commitDate: "2024-01-15T10:00:00Z",
            subject: "Fix: handle \"edge cases\", properly",
            message: "Fix: handle \"edge cases\", properly",
            patchId: "pid1",
            processedPlugins: ["linecount"],
            results: { linecount: { totalLines: 1 } }
          }]
        }

        yield* fs.writeFileString(inputPath, JSON.stringify(statsJson))

        yield* render({ input: inputPath, output: outputPath }).pipe(
          Effect.provide(NodeContext.layer)
        )

        const csv = yield* fs.readFileString(outputPath)
        const lines = csv.trim().split("\n")
        const dataRow = lines[1]!

        expect(dataRow).toContain("\"Alice, Jr.\"")
        expect(dataRow).toContain("\"Fix: handle \"\"edge cases\"\", properly\"")
      })
    ).pipe(Effect.provide(NodeContext.layer)), 15000)
})
