import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import type * as Scope from "effect/Scope"
import { GitError } from "./errors/GitError.js"
import { GitService } from "./GitService.js"

export interface WorktreeManagerShape {
  readonly withWorktree: <A, E, R>(
    commitSha: string,
    f: (worktreePath: string) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | GitError, R | Scope.Scope>
  readonly pruneOrphaned: () => Effect.Effect<void, GitError>
}

export class WorktreeManager extends Context.Tag("WorktreeManager")<
  WorktreeManager,
  WorktreeManagerShape
>() {
  static Live = Layer.effect(
    WorktreeManager,
    Effect.gen(function*() {
      const git = yield* GitService
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      return {
        withWorktree: <A, E, R>(
          commitSha: string,
          f: (worktreePath: string) => Effect.Effect<A, E, R>
        ) =>
          Effect.gen(function*() {
            const tempDir = yield* fs
              .makeTempDirectoryScoped({ prefix: "slurp-wt-" })
              .pipe(
                Effect.mapError(
                  (err) =>
                    new GitError({
                      command: "makeTempDirectoryScoped",
                      message: err.message
                    })
                )
              )

            yield* fs
              .remove(tempDir, { recursive: true })
              .pipe(
                Effect.mapError(
                  (err) =>
                    new GitError({
                      command: "remove",
                      message: err.message
                    })
                )
              )

            yield* git.createWorktree(commitSha, tempDir)

            return yield* f(tempDir).pipe(
              Effect.ensuring(
                git.removeWorktree(tempDir).pipe(Effect.ignore)
              )
            )
          }),

        pruneOrphaned: () =>
          Effect.gen(function*() {
            yield* git.worktreePrune()

            // Discover OS temp dir by probing
            const probeDir = yield* fs
              .makeTempDirectory({ prefix: "slurp-probe-" })
              .pipe(
                Effect.mapError(
                  (err) =>
                    new GitError({
                      command: "makeTempDirectory",
                      message: err.message
                    })
                )
              )
            const tmpDir = path.dirname(probeDir)
            yield* fs.remove(probeDir, { recursive: true }).pipe(Effect.ignore)

            const entries = yield* fs.readDirectory(tmpDir).pipe(
              Effect.mapError(
                (err) =>
                  new GitError({
                    command: "readDirectory",
                    message: err.message
                  })
              )
            )

            yield* Effect.forEach(
              entries.filter((name) => name.startsWith("slurp-wt-")),
              (name) =>
                fs
                  .remove(path.join(tmpDir, name), { recursive: true })
                  .pipe(Effect.ignore),
              { concurrency: "unbounded" }
            )
          })
      }
    })
  )
}
