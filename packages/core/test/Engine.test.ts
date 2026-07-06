import { NodeContext } from "@effect/platform-node"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { type AnalyzeContext, definePlugin, PluginError } from "@slurp/plugin"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { Engine } from "../src/Engine.js"
import type { EngineConfig } from "../src/Engine.js"
import { GitService } from "../src/GitService.js"
import { PluginRegistry } from "../src/PluginRegistry.js"
import { StatsStore } from "../src/StatsStore.js"
import { WorktreeManager } from "../src/WorktreeManager.js"

const countingPlugin = definePlugin({
  name: "counting",
  version: "0.1.0",
  analyze: (_ctx: AnalyzeContext) => Effect.succeed({ lineCount: 42 })
})

const flakyPlugin = definePlugin({
  name: "flaky",
  version: "0.1.0",
  analyze: () =>
    Effect.fail(
      new PluginError({
        pluginName: "flaky",
        message: "Intentional failure"
      })
    )
})

const createTestRepo = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const executor = yield* CommandExecutor.CommandExecutor

  const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-engine-" })

  yield* executor.string(Command.make("git", "init", tempDir))
  yield* executor.string(Command.make("git", "-C", tempDir, "config", "user.name", "Test"))
  yield* executor.string(Command.make("git", "-C", tempDir, "config", "user.email", "test@test.com"))
  yield* executor.string(Command.make("git", "-C", tempDir, "config", "commit.gpgsign", "false"))

  yield* fs.writeFileString(`${tempDir}/file1.ts`, "console.log('hello')\n")
  yield* executor.string(Command.make("git", "-C", tempDir, "add", "."))
  yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Initial commit"))

  yield* fs.writeFileString(`${tempDir}/file2.ts`, "export const x = 1\n")
  yield* executor.string(Command.make("git", "-C", tempDir, "add", "."))
  yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Add file2"))

  yield* fs.writeFileString(`${tempDir}/file3.ts`, "export const y = 2\n")
  yield* executor.string(Command.make("git", "-C", tempDir, "add", "."))
  yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Add file3"))

  return tempDir
})

const testLayer = (
  repoPath: string,
  plugins: ReadonlyArray<typeof countingPlugin> = [countingPlugin]
) =>
  Engine.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        PluginRegistry.fromPlugins(plugins),
        WorktreeManager.Live.pipe(Layer.provide(GitService.Live(repoPath))),
        GitService.Live(repoPath),
        StatsStore.Live
      )
    )
  )

const makeConfig = (repoPath: string, outputPath: string): EngineConfig => ({
  repoPath,
  outputPath,
  maxConcurrency: 2,
  processMerges: false,
  dryRun: false,
  pluginFilter: Option.none()
})

describe.sequential("Engine", () => {
  it.effect("runs end-to-end against a real repo and produces a stats file", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const statsPath = path.join(tempDir, "stats.json")

        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run(makeConfig(tempDir, statsPath))
        }).pipe(Effect.provide(testLayer(tempDir)))

        const exists = yield* fs.exists(statsPath)
        expect(exists).toBe(true)

        const content = yield* fs.readFileString(statsPath)
        const parsed = JSON.parse(content)
        expect(parsed.version).toBe("1.0.0")
        expect(parsed.commits).toHaveLength(3)
        expect(parsed.commits[0].subject).toBe("Initial commit")
        expect(parsed.commits[2].subject).toBe("Add file3")
        expect(parsed.commits[0].results.counting).toEqual({ lineCount: 42 })
      })
    ).pipe(Effect.provide(NodeContext.layer)), 60000)

  it.effect("second run on unchanged repo processes 0 commits (incremental)", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const statsPath = path.join(tempDir, "stats.json")
        const config = makeConfig(tempDir, statsPath)

        // First run
        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run(config)
        }).pipe(Effect.provide(testLayer(tempDir)))

        const content1 = yield* fs.readFileString(statsPath)
        const parsed1 = JSON.parse(content1)

        // Second run
        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run(config)
        }).pipe(Effect.provide(testLayer(tempDir)))

        const content2 = yield* fs.readFileString(statsPath)
        const parsed2 = JSON.parse(content2)

        // Same commits with same results
        expect(parsed2.commits).toHaveLength(parsed1.commits.length)
        expect(parsed2.commits[0].results.counting).toEqual(parsed1.commits[0].results.counting)
      })
    ).pipe(Effect.provide(NodeContext.layer)), 60000)

  it.effect("error isolation: failing plugin does not stop other plugins or commits", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const statsPath = path.join(tempDir, "stats.json")

        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run(makeConfig(tempDir, statsPath))
        }).pipe(Effect.provide(testLayer(tempDir, [countingPlugin, flakyPlugin])))

        const content = yield* fs.readFileString(statsPath)
        const parsed = JSON.parse(content)

        // counting should still have results despite flaky failing
        expect(parsed.commits[0].results.counting).toEqual({ lineCount: 42 })
        expect(parsed.commits[0].processedPlugins).toContain("counting")
        expect(parsed.commits[0].processedPlugins).toContain("flaky")
      })
    ).pipe(Effect.provide(NodeContext.layer)), 60000)

  it.effect("gap-filling: adding a new plugin only processes that plugin for existing commits", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const statsPath = path.join(tempDir, "stats.json")

        // First run with only countingPlugin
        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run(makeConfig(tempDir, statsPath))
        }).pipe(Effect.provide(testLayer(tempDir, [countingPlugin])))

        const content1 = yield* fs.readFileString(statsPath)
        const parsed1 = JSON.parse(content1)
        expect(parsed1.commits[0].processedPlugins).toEqual(["counting"])

        // Second run with both plugins (flaky is like a new plugin)
        // Use a different plugin that succeeds
        const secondPlugin = definePlugin({
          name: "second",
          version: "0.1.0",
          analyze: () => Effect.succeed({ data: "hello" })
        })

        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run(makeConfig(tempDir, statsPath))
        }).pipe(Effect.provide(testLayer(tempDir, [countingPlugin, secondPlugin])))

        const content2 = yield* fs.readFileString(statsPath)
        const parsed2 = JSON.parse(content2)

        // Both plugins should be in processedPlugins
        expect(parsed2.commits[0].processedPlugins).toContain("counting")
        expect(parsed2.commits[0].processedPlugins).toContain("second")
        // counting results should still be there
        expect(parsed2.commits[0].results.counting).toEqual({ lineCount: 42 })
        // second results should be there
        expect(parsed2.commits[0].results.second).toEqual({ data: "hello" })
      })
    ).pipe(Effect.provide(NodeContext.layer)), 60000)

  it.effect("dry-run shows work items without processing", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const statsPath = path.join(tempDir, "stats.json")

        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run({ ...makeConfig(tempDir, statsPath), dryRun: true })
        }).pipe(Effect.provide(testLayer(tempDir)))

        // Dry run should not create stats file
        const exists = yield* fs.exists(statsPath)
        expect(exists).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)), 60000)

  it.effect("merge commits are skipped by default", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo
        const fs = yield* FileSystem.FileSystem
        const executor = yield* CommandExecutor.CommandExecutor
        const path = yield* Path.Path
        const statsPath = path.join(tempDir, "stats.json")

        // Create a merge commit
        yield* executor.string(Command.make("git", "-C", tempDir, "checkout", "-b", "feature"))
        yield* fs.writeFileString(`${tempDir}/feature.ts`, "export const z = 3\n")
        yield* executor.string(Command.make("git", "-C", tempDir, "add", "."))
        yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Feature commit"))
        yield* executor.string(Command.make("git", "-C", tempDir, "checkout", "master"))
        yield* executor.string(Command.make("git", "-C", tempDir, "merge", "--no-ff", "feature", "-m", "Merge feature"))

        yield* Effect.gen(function*() {
          const engine = yield* Engine
          yield* engine.run(makeConfig(tempDir, statsPath))
        }).pipe(Effect.provide(testLayer(tempDir)))

        const content = yield* fs.readFileString(statsPath)
        const parsed = JSON.parse(content)

        // 3 original + 1 feature + 1 merge = 5 commits
        expect(parsed.commits).toHaveLength(5)

        // Find the merge commit
        const mergeCommit = parsed.commits.find((c: { subject: string }) => c.subject === "Merge feature")
        expect(mergeCommit).toBeDefined()
        expect(mergeCommit.processedPlugins).toEqual([])
        expect(mergeCommit.results).toEqual({})
      })
    ).pipe(Effect.provide(NodeContext.layer)), 60000)
})
