import { NodeContext } from "@effect/platform-node"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { GitService } from "../src/GitService.js"
import { WorktreeManager } from "../src/WorktreeManager.js"

const createTestRepo = Effect.gen(function*() {
  const fs = yield* FileSystem.FileSystem
  const executor = yield* CommandExecutor.CommandExecutor

  const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })

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

  return tempDir
})

const testLayer = (repoPath: string) =>
  WorktreeManager.Live.pipe(
    Layer.provideMerge(GitService.Live(repoPath))
  )

describe.sequential("WorktreeManager", () => {
  it.effect("withWorktree creates worktree, runs effect, and cleans up", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        const result = yield* Effect.gen(function*() {
          const wt = yield* WorktreeManager
          const git = yield* GitService
          const fs = yield* FileSystem.FileSystem
          const headSha = yield* git.getHeadSha()

          return yield* wt.withWorktree(headSha, (worktreePath) =>
            Effect.gen(function*() {
              const exists = yield* fs.exists(`${worktreePath}/file2.ts`)
              return exists
            }))
        }).pipe(Effect.provide(testLayer(tempDir)))

        expect(result).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)), 30000)

  it.effect("withWorktree cleans up worktree on scope exit even when effect fails", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        const result = yield* Effect.either(
          Effect.gen(function*() {
            const wt = yield* WorktreeManager
            const git = yield* GitService
            const headSha = yield* git.getHeadSha()

            yield* wt.withWorktree(headSha, () => Effect.fail(new Error("intentional failure")))
          }).pipe(Effect.provide(testLayer(tempDir)))
        )

        expect(result._tag).toBe("Left")
      })
    ).pipe(Effect.provide(NodeContext.layer)), 30000)

  it.effect("pruneOrphaned completes without error", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        yield* Effect.gen(function*() {
          const wt = yield* WorktreeManager
          yield* wt.pruneOrphaned()
        }).pipe(Effect.provide(testLayer(tempDir)))
      })
    ).pipe(Effect.provide(NodeContext.layer)), 30000)
})
