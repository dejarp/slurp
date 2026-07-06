import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { type AnalyzeContext } from "@slurp/plugin"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import linecountPlugin, { LinecountResult } from "../src/index.js"

describe("linecount plugin", () => {
  it("defines itself with correct name and version", () => {
    expect(linecountPlugin.name).toBe("linecount")
    expect(linecountPlugin.version).toBe("0.1.0")
  })

  it.effect("counts lines of code by file extension", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-lc-test-" })

        yield* fs.writeFileString(path.join(tempDir, "a.ts"), "line1\nline2\nline3\n")
        yield* fs.writeFileString(path.join(tempDir, "b.ts"), "line1\n")
        yield* fs.writeFileString(path.join(tempDir, "c.js"), "line1\nline2\n")
        yield* fs.writeFileString(path.join(tempDir, "d.json"), "{\"a\":1}\n")
        yield* fs.makeDirectory(path.join(tempDir, "subdir"))
        yield* fs.writeFileString(path.join(tempDir, "subdir", "e.ts"), "x\ny\n")

        const ctx: AnalyzeContext = {
          worktreePath: tempDir,
          repoPath: "/fake/repo",
          commit: {
            sha: "abc123",
            abbreviatedSha: "abc",
            parents: [],
            authorName: "T",
            authorEmail: "t@t.com",
            authorDate: "2024-01-15T10:00:00Z",
            commitDate: "2024-01-15T10:00:00Z",
            subject: "S",
            message: "S"
          }
        }

        const result = yield* linecountPlugin.analyze(ctx).pipe(
          Effect.provide(NodeContext.layer)
        )

        expect(result).toEqual({
          totalLines: 9,
          byExtension: {
            ".ts": 6,
            ".js": 2,
            ".json": 1
          }
        })
      })
    ).pipe(Effect.provide(NodeContext.layer)), 15000)

  it.effect("excludes .git directory from counting", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-lc-git-" })

        yield* fs.writeFileString(path.join(tempDir, "main.ts"), "hello\n")
        yield* fs.makeDirectory(path.join(tempDir, ".git"))
        yield* fs.writeFileString(
          path.join(tempDir, ".git", "config"),
          "[core]\n\trepositoryformatversion = 0\n"
        )

        const ctx: AnalyzeContext = {
          worktreePath: tempDir,
          repoPath: "/fake/repo",
          commit: {
            sha: "abc",
            abbreviatedSha: "abc",
            parents: [],
            authorName: "T",
            authorEmail: "t@t.com",
            authorDate: "2024-01-15T10:00:00Z",
            commitDate: "2024-01-15T10:00:00Z",
            subject: "S",
            message: "S"
          }
        }

        const result = yield* linecountPlugin.analyze(ctx).pipe(
          Effect.provide(NodeContext.layer)
        )

        expect(result).toMatchObject({ totalLines: 1, byExtension: { ".ts": 1 } })
      })
    ).pipe(Effect.provide(NodeContext.layer)), 15000)

  it.effect("result passes schema validation", () =>
    Effect.gen(function*() {
      const valid = { totalLines: 10, byExtension: { ".ts": 10 } }
      const result = yield* Schema.decodeUnknown(LinecountResult)(valid)
      expect(result.totalLines).toBe(10)

      const invalid = { totalLines: "not-a-number" }
      const error = yield* Schema.decodeUnknown(LinecountResult)(invalid).pipe(
        Effect.either
      )
      expect(error._tag).toBe("Left")
    }), 5000)
})
