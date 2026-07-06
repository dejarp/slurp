import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import { CommitInfo } from "@slurp/plugin"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Stream from "effect/Stream"
import { GitError } from "./errors/GitError.js"

export interface WorktreeRef {
  readonly path: string
  readonly commitSha: string
}

export interface GitServiceShape {
  readonly getCommitLog: () => Stream.Stream<CommitInfo, GitError>
  readonly getPatchId: (commitSha: string) => Effect.Effect<Option.Option<string>, GitError>
  readonly createWorktree: (commitSha: string, path: string) => Effect.Effect<WorktreeRef, GitError>
  readonly removeWorktree: (path: string) => Effect.Effect<void, GitError>
  readonly getHeadSha: () => Effect.Effect<string, GitError>
  readonly worktreePrune: () => Effect.Effect<void, GitError>
}

export class GitService extends Context.Tag("GitService")<GitService, GitServiceShape>() {
  static Live = (repoPath: string): Layer.Layer<GitService, never, CommandExecutor.CommandExecutor> =>
    Layer.effect(GitService, makeGitService(repoPath))
}

const FIELD_SEP = "\x1f"
const RECORD_SEP = "\x1e"
const GIT_LOG_FORMAT = "%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s%x1f%B%x1e"

const parseCommitRecord = (record: string): CommitInfo => {
  const fields = record.trim().split(FIELD_SEP)
  const [sha, abbreviatedSha, parentsStr, authorName, authorEmail, authorDate, commitDate, subject] = fields
  const message = fields.slice(8).join(FIELD_SEP).trim()

  return new CommitInfo({
    sha: sha ?? "",
    abbreviatedSha: abbreviatedSha ?? "",
    parents: parentsStr && parentsStr.trim().length > 0 ? parentsStr.trim().split(" ") : [],
    authorName: authorName ?? "",
    authorEmail: authorEmail ?? "",
    authorDate: authorDate ?? "",
    commitDate: commitDate ?? "",
    subject: subject ?? "",
    message
  })
}

const describeCommand = (cmd: Command.Command): string => {
  switch (cmd._tag) {
    case "StandardCommand":
      return `${cmd.command} ${cmd.args.join(" ")}`
    case "PipedCommand":
      return `${describeCommand(cmd.left)} | ${describeCommand(cmd.right)}`
  }
}

const makeGitService = (
  repoPath: string
): Effect.Effect<GitServiceShape, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*() {
    const executor = yield* CommandExecutor.CommandExecutor

    const gitCmd = (...args: Array<string>): Command.Command =>
      Command.make("git", ...args).pipe(Command.workingDirectory(repoPath))

    const runGitString = (cmd: Command.Command): Effect.Effect<string, GitError> =>
      executor.string(cmd).pipe(
        Effect.mapError((err) =>
          new GitError({
            command: describeCommand(cmd),
            message: err.message
          })
        )
      )

    return {
      getCommitLog: () =>
        Stream.fromIterableEffect(
          runGitString(
            gitCmd("log", `--format=${GIT_LOG_FORMAT}`, "HEAD")
          ).pipe(
            Effect.map((output) =>
              output
                .split(RECORD_SEP)
                .filter((r) => r.trim().length > 0)
                .map(parseCommitRecord)
            )
          )
        ),

      getPatchId: (commitSha) =>
        Effect.gen(function*() {
          const parentsStr = yield* runGitString(
            gitCmd("log", "-1", "--format=%P", commitSha)
          )
          const parents = parentsStr.trim().split(" ").filter((p) => p.length > 0)

          const patchCmd = parents.length > 1
            ? Command.pipeTo(
              Command.make("git", "diff", `${parents[0]}..${commitSha}`),
              Command.make("git", "patch-id")
            ).pipe(Command.workingDirectory(repoPath))
            : Command.pipeTo(
              Command.make("git", "show", commitSha),
              Command.make("git", "patch-id")
            ).pipe(Command.workingDirectory(repoPath))

          const output = yield* runGitString(patchCmd)
          const trimmed = output.trim()
          if (trimmed.length === 0) {
            return Option.none()
          }
          return Option.some(trimmed.split(/\s+/)[0]!)
        }),

      createWorktree: (commitSha, path) =>
        runGitString(gitCmd("worktree", "add", "--detach", path, commitSha)).pipe(
          Effect.as({ path, commitSha } satisfies WorktreeRef)
        ),

      removeWorktree: (path) => runGitString(gitCmd("worktree", "remove", path)).pipe(Effect.as(undefined)),

      getHeadSha: () => runGitString(gitCmd("rev-parse", "HEAD")).pipe(Effect.map((s) => s.trim())),

      worktreePrune: () => runGitString(gitCmd("worktree", "prune")).pipe(Effect.as(undefined))
    }
  })
