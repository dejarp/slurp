import { NodeContext } from "@effect/platform-node"
import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import { describe, expect, it } from "@effect/vitest"
import type { CommitInfo } from "@slurp/plugin"
import * as Chunk from "effect/Chunk"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { GitService } from "../src/GitService.js"

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
  yield* executor.string(Command.make("git", "-C", tempDir, "commit", "-m", "Add file2\n\nMulti-line body"))

  return tempDir
})

describe("GitService", () => {
  it.effect("getCommitLog streams commits with correct metadata", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        const commits = yield* Effect.gen(function*() {
          const git = yield* GitService
          return yield* Stream.runCollect(git.getCommitLog())
        }).pipe(Effect.provide(GitService.Live(tempDir)))

        const arr = Chunk.toReadonlyArray(commits)
        expect(arr).toHaveLength(2)

        const newest = arr[0] as CommitInfo
        const oldest = arr[1] as CommitInfo

        expect(newest.parents).toHaveLength(1)
        expect(newest.subject).toBe("Add file2")
        expect(newest.message).toContain("Multi-line body")
        expect(newest.authorName).toBe("Test")
        expect(newest.authorEmail).toBe("test@test.com")

        expect(oldest.subject).toBe("Initial commit")
        expect(oldest.parents).toHaveLength(0)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("getPatchId returns stable hash", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        const result = yield* Effect.gen(function*() {
          const git = yield* GitService
          const headSha = yield* git.getHeadSha()
          return yield* git.getPatchId(headSha)
        }).pipe(Effect.provide(GitService.Live(tempDir)))

        expect(Option.isSome(result)).toBe(true)
        if (Option.isSome(result)) {
          expect(result.value).toMatch(/^[0-9a-f]+$/)
        }
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("createWorktree and removeWorktree lifecycle", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        const result = yield* Effect.gen(function*() {
          const git = yield* GitService
          const fs = yield* FileSystem.FileSystem

          const headSha = yield* git.getHeadSha()

          const wtPath = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-wt-" })
          yield* fs.remove(wtPath, { recursive: true })

          const ref = yield* git.createWorktree(headSha, wtPath)

          const exists = yield* fs.exists(`${wtPath}/file2.ts`)
          expect(exists).toBe(true)

          yield* git.removeWorktree(wtPath)

          return ref
        }).pipe(Effect.provide(GitService.Live(tempDir)))

        expect(result.commitSha).toBeDefined()
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("getHeadSha returns current HEAD sha", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        const sha = yield* Effect.gen(function*() {
          const git = yield* GitService
          return yield* git.getHeadSha()
        }).pipe(Effect.provide(GitService.Live(tempDir)))

        expect(sha).toMatch(/^[0-9a-f]{40}$/)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("worktreePrune completes without error", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const tempDir = yield* createTestRepo

        yield* Effect.gen(function*() {
          const git = yield* GitService
          yield* git.worktreePrune()
        }).pipe(Effect.provide(GitService.Live(tempDir)))
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})
