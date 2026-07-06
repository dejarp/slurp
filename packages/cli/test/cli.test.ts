import { Command as CliCommand } from "@effect/cli"
import { NodeContext } from "@effect/platform-node"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { StatsFile } from "@slurp/core"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { rootCommand } from "../src/Commands.js"

const run = rootCommand.pipe(
  CliCommand.run({
    name: "slurp",
    version: "0.1.0"
  })
)

const createTestRepo = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const executor = yield* CommandExecutor.CommandExecutor
  const pathSvc = yield* Path.Path

  const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-cli-test-" })

  yield* executor.string(Command.make("git", "-C", tempDir, "init"))
  yield* executor.string(Command.make("git", "-C", tempDir, "config", "user.name", "Test"))
  yield* executor.string(Command.make("git", "-C", tempDir, "config", "user.email", "test@test.com"))
  yield* executor.string(Command.make("git", "-C", tempDir, "config", "commit.gpgsign", "false"))

  yield* fs.writeFileString(pathSvc.join(tempDir, "file1.ts"), "console.log('hello')\n")
  yield* executor.string(Command.make("git", "-C", tempDir, "add", "."))
  yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Initial commit"))

  yield* fs.writeFileString(pathSvc.join(tempDir, "file2.ts"), "export const x = 1\n")
  yield* executor.string(Command.make("git", "-C", tempDir, "add", "."))
  yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Add file2"))

  return tempDir
})

const createTestRepoWithMerge = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const executor = yield* CommandExecutor.CommandExecutor
  const pathSvc = yield* Path.Path

  const tempDir = yield* createTestRepo

  yield* executor.string(Command.make("git", "-C", tempDir, "checkout", "-b", "feature"))
  yield* fs.writeFileString(pathSvc.join(tempDir, "feature.ts"), "export const f = 1\n")
  yield* executor.string(Command.make("git", "-C", tempDir, "add", "."))
  yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Feature commit"))
  yield* executor.string(Command.make("git", "-C", tempDir, "checkout", "master"))
  yield* executor.string(Command.make("git", "-C", tempDir, "merge", "--no-ff", "feature", "-m", "Merge feature"))

  return tempDir
})

describe.sequential("CLI", () => {
  it.scoped("run creates stats file", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathSvc = yield* Path.Path

      const tempDir = yield* createTestRepo
      const statsPath = pathSvc.join(tempDir, "stats.json")

      yield* run(["node", "slurp.js", "run", tempDir, "--output", statsPath, "--concurrency", "2"])

      const exists = yield* fs.exists(statsPath)
      expect(exists).toBe(true)

      const content = yield* fs.readFileString(statsPath)
      const decoded = yield* Schema.decodeUnknown(StatsFile)(JSON.parse(content))
      expect(decoded.commits.length).toBe(2)
      expect(decoded.commits[0].subject).toBe("Initial commit")
      expect(decoded.commits[1].subject).toBe("Add file2")
    }).pipe(Effect.provide(NodeContext.layer)))

  it.scoped("run --dry-run does not create stats file", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathSvc = yield* Path.Path

      const tempDir = yield* createTestRepo
      const statsPath = pathSvc.join(tempDir, "stats-dry.json")

      yield* run(["node", "slurp.js", "run", tempDir, "--output", statsPath, "--dry-run"])

      const exists = yield* fs.exists(statsPath)
      expect(exists).toBe(false)
    }).pipe(Effect.provide(NodeContext.layer)))

  it.scoped("run skips merge commits by default", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathSvc = yield* Path.Path

      const tempDir = yield* createTestRepoWithMerge
      const statsPath = pathSvc.join(tempDir, "stats.json")

      yield* run(["node", "slurp.js", "run", tempDir, "--output", statsPath, "--concurrency", "2"])

      const content = yield* fs.readFileString(statsPath)
      const decoded = yield* Schema.decodeUnknown(StatsFile)(JSON.parse(content))

      const mergeCommits = decoded.commits.filter((c) => c.parents.length > 1)
      expect(mergeCommits.length).toBe(1)
      const mergeCommit = mergeCommits[0]
      expect(mergeCommit.processedPlugins.length).toBe(0)
      expect(Object.keys(mergeCommit.results).length).toBe(0)
    }).pipe(Effect.provide(NodeContext.layer)))

  it.scoped("run --process-merges processes merge commits", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathSvc = yield* Path.Path

      const tempDir = yield* createTestRepoWithMerge
      const statsPath = pathSvc.join(tempDir, "stats.json")

      yield* run(["node", "slurp.js", "run", tempDir, "--output", statsPath, "--concurrency", "2", "--process-merges"])

      const content = yield* fs.readFileString(statsPath)
      const decoded = yield* Schema.decodeUnknown(StatsFile)(JSON.parse(content))

      const mergeCommits = decoded.commits.filter((c) => c.parents.length > 1)
      expect(mergeCommits.length).toBe(1)
    }).pipe(Effect.provide(NodeContext.layer)))

  it.scoped("render produces CSV from stats", () =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const pathSvc = yield* Path.Path

      const tempDir = yield* createTestRepo
      const statsPath = pathSvc.join(tempDir, "stats.json")
      const csvPath = pathSvc.join(tempDir, "report.csv")

      yield* run(["node", "slurp.js", "run", tempDir, "--output", statsPath, "--concurrency", "2"])
      yield* run(["node", "slurp.js", "render", "--input", statsPath, "--format", "csv", "--output", csvPath])

      const exists = yield* fs.exists(csvPath)
      expect(exists).toBe(true)

      const csv = yield* fs.readFileString(csvPath)
      const lines = csv.trim().split("\n")
      expect(lines[0]).toContain("sha")
      expect(lines[0]).toContain("abbreviatedSha")
      expect(lines[0]).toContain("subject")
      expect(lines.length).toBe(3)
    }).pipe(Effect.provide(NodeContext.layer)))
})
