import type { AnalyzeContext, CommitInfo } from "@slurp/plugin"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Ref from "effect/Ref"
import type * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import { EngineError } from "./errors/EngineError.js"
import type { GitError } from "./errors/GitError.js"
import type { GitServiceShape } from "./GitService.js"
import { GitService } from "./GitService.js"
import { PluginRegistry } from "./PluginRegistry.js"
import type { PluginResult } from "./PluginResult.js"
import { CommitStats } from "./schema/CommitStats.js"
import { StatsFile } from "./schema/StatsFile.js"
import { StatsStore } from "./StatsStore.js"
import { WorktreeManager } from "./WorktreeManager.js"

const STATS_VERSION = "1.0.0"
const SLURP_VERSION = "0.1.0"

export interface EngineConfig {
  readonly repoPath: string
  readonly outputPath: string
  readonly maxConcurrency: number
  readonly processMerges: boolean
  readonly dryRun: boolean
  readonly pluginFilter: Option.Option<ReadonlyArray<string>>
}

interface WorkItemNew {
  readonly _tag: "WorkItemNew"
  readonly commit: CommitInfo
  readonly reason: "new" | "rebased" | "reprocess"
}

interface WorkItemGapFill {
  readonly _tag: "WorkItemGapFill"
  readonly commit: CommitInfo
  readonly missingPlugins: ReadonlyArray<string>
  readonly existing: CommitStats
}

type WorkItem = WorkItemNew | WorkItemGapFill

interface ReconcileResult {
  readonly workItems: ReadonlyArray<WorkItem>
  readonly carriedOver: ReadonlyMap<string, CommitStats>
}

const isMergeCommit = (commit: CommitInfo): boolean => commit.parents.length > 1

const findMissingPlugins = (
  processedPlugins: ReadonlyArray<string>,
  activePluginNames: ReadonlyArray<string>
): ReadonlyArray<string> => activePluginNames.filter((name) => !processedPlugins.includes(name))

const reconcile = (
  stored: Option.Option<StatsFile>,
  currentCommits: ReadonlyArray<CommitInfo>,
  activePluginNames: ReadonlyArray<string>,
  git: GitServiceShape,
  processMerges: boolean
): Effect.Effect<ReconcileResult, GitError> =>
  Effect.gen(function*() {
    if (Option.isNone(stored)) {
      const items: Array<WorkItem> = []
      for (const commit of currentCommits) {
        if (!processMerges && isMergeCommit(commit)) continue
        items.push({ _tag: "WorkItemNew", commit, reason: "new" })
      }
      return { workItems: items, carriedOver: new Map<string, CommitStats>() }
    }

    const storedCommits = stored.value.commits
    const storedBySha = new Map(storedCommits.map((c) => [c.sha, c] as const))
    const storedByPatchId = new Map(
      storedCommits
        .filter((c) => c.patchId !== null)
        .map((c) => [c.patchId as string, c] as const)
    )
    const currentShaSet = new Set(currentCommits.map((c) => c.sha))

    const goneStored = storedCommits.filter(
      (c) => !currentShaSet.has(c.sha) && c.patchId !== null
    )

    const newCurrentCommits = currentCommits.filter(
      (c) => !storedBySha.has(c.sha)
    )

    const patchIdByNewSha = new Map<string, string>()

    if (goneStored.length > 0 && newCurrentCommits.length > 0) {
      const results = yield* Effect.forEach(
        newCurrentCommits,
        (c) =>
          git.getPatchId(c.sha).pipe(
            Effect.map((opt) => [c.sha, opt] as const)
          ),
        { concurrency: "unbounded" }
      )
      for (const [sha, opt] of results) {
        if (Option.isSome(opt)) {
          patchIdByNewSha.set(sha, opt.value)
        }
      }
    }

    const items: Array<WorkItem> = []
    const carried = new Map<string, CommitStats>()

    for (const commit of currentCommits) {
      if (!processMerges && isMergeCommit(commit)) continue

      const existing = storedBySha.get(commit.sha)

      if (existing !== undefined) {
        if (existing.patchId === null) {
          items.push({ _tag: "WorkItemNew", commit, reason: "reprocess" })
        } else {
          const missing = findMissingPlugins(
            existing.processedPlugins,
            activePluginNames
          )
          if (missing.length > 0) {
            items.push({
              _tag: "WorkItemGapFill",
              commit,
              missingPlugins: missing,
              existing
            })
          } else {
            carried.set(commit.sha, existing)
          }
        }
      } else {
        const patchId = patchIdByNewSha.get(commit.sha)
        const isRebased = patchId !== undefined && storedByPatchId.has(patchId)
        items.push({
          _tag: "WorkItemNew",
          commit,
          reason: isRebased ? "rebased" : "new"
        })
      }
    }

    return { workItems: items, carriedOver: carried }
  })

const resultsToStats = (
  pluginResults: ReadonlyArray<PluginResult>,
  existingResults: Record<string, unknown>,
  existingProcessedPlugins: ReadonlyArray<string>
): {
  results: Record<string, unknown>
  processedPlugins: Array<string>
} => {
  const results: Record<string, unknown> = { ...existingResults }
  const processedPlugins = [...existingProcessedPlugins]

  for (const result of pluginResults) {
    if (!processedPlugins.includes(result.pluginName)) {
      processedPlugins.push(result.pluginName)
    }
    if (result._tag === "PluginResultSuccess") {
      results[result.pluginName] = result.result
    }
  }

  return { results, processedPlugins }
}

const toCommitStats = (
  commit: CommitInfo,
  patchId: string | null,
  processedPlugins: ReadonlyArray<string>,
  results: Record<string, unknown>
): CommitStats =>
  new CommitStats({
    sha: commit.sha,
    abbreviatedSha: commit.abbreviatedSha,
    parents: commit.parents,
    authorName: commit.authorName,
    authorEmail: commit.authorEmail,
    authorDate: commit.authorDate,
    commitDate: commit.commitDate,
    subject: commit.subject,
    message: commit.message,
    patchId,
    processedPlugins: [...processedPlugins],
    results
  })

const buildStatsFile = (
  repoPath: string,
  headSha: string,
  plugins: ReadonlyArray<{ name: string; version: string }>,
  commits: ReadonlyArray<CommitStats>
): StatsFile =>
  new StatsFile({
    version: STATS_VERSION,
    slurpVersion: SLURP_VERSION,
    repo: { path: repoPath, head: headSha },
    plugins: [...plugins],
    commits: [...commits]
  })

export interface EngineShape {
  readonly run: (config: EngineConfig) => Effect.Effect<void, EngineError>
}

export class Engine extends Context.Tag("Engine")<Engine, EngineShape>() {
  static Live = Layer.effect(
    Engine,
    Effect.gen(function*() {
      const git = yield* GitService
      const wt = yield* WorktreeManager
      const registry = yield* PluginRegistry
      const store = yield* StatsStore

      const processWorkItem = (
        item: WorkItem,
        config: EngineConfig
      ): Effect.Effect<CommitStats, GitError, Scope.Scope> =>
        Effect.gen(function*() {
          const pluginResults = yield* wt.withWorktree(
            item.commit.sha,
            (worktreePath) =>
              Effect.gen(function*() {
                const ctx: AnalyzeContext = {
                  worktreePath,
                  commit: item.commit,
                  repoPath: config.repoPath
                }
                if (item._tag === "WorkItemNew") {
                  return yield* registry.runAllPlugins(ctx)
                }
                return yield* registry.runPlugins(item.missingPlugins, ctx)
              })
          )

          for (const result of pluginResults) {
            if (result._tag === "PluginResultFailure") {
              yield* Effect.logWarning(
                `Plugin ${result.pluginName} failed for ${item.commit.abbreviatedSha}: ${result.error.message}`
              )
            }
          }

          if (item._tag === "WorkItemGapFill") {
            const { results, processedPlugins } = resultsToStats(
              pluginResults,
              item.existing.results as Record<string, unknown>,
              item.existing.processedPlugins
            )
            return toCommitStats(
              item.commit,
              item.existing.patchId,
              processedPlugins,
              results
            )
          }

          const patchId = yield* git.getPatchId(item.commit.sha)
          const { results, processedPlugins } = resultsToStats(
            pluginResults,
            {},
            []
          )
          return toCommitStats(
            item.commit,
            Option.getOrElse(patchId, () => null),
            processedPlugins,
            results
          )
        })

      const pluginInfos = registry.plugins.map((p) => ({
        name: p.name,
        version: p.version
      }))

      const run = (config: EngineConfig): Effect.Effect<void, EngineError> =>
        Effect.gen(function*() {
          yield* wt.pruneOrphaned()
          yield* store.removeStaleLock(config.outputPath)

          const existing = yield* store.load(config.outputPath)

          const commits = yield* Stream.runCollect(git.getCommitLog()).pipe(
            Effect.map((chunk) => Array.from(chunk).reverse())
          )

          if (commits.length === 0) {
            yield* Effect.log("No commits found in repository")
            return
          }

          const activePluginNames = Option.match(config.pluginFilter, {
            onNone: () => registry.pluginNames,
            onSome: (names) => registry.pluginNames.filter((n) => names.includes(n))
          })

          yield* Effect.log(
            `Discovered plugins: ${registry.pluginNames.join(", ") || "(none)"}`
          )

          const { workItems, carriedOver } = yield* reconcile(
            existing,
            commits,
            activePluginNames,
            git,
            config.processMerges
          )

          const newCount = workItems.filter(
            (w) => w._tag === "WorkItemNew" && w.reason === "new"
          ).length
          const rebasedCount = workItems.filter(
            (w) => w._tag === "WorkItemNew" && w.reason === "rebased"
          ).length
          const reprocessCount = workItems.filter(
            (w) => w._tag === "WorkItemNew" && w.reason === "reprocess"
          ).length
          const gapFillCount = workItems.filter(
            (w) => w._tag === "WorkItemGapFill"
          ).length

          yield* Effect.log(
            `${newCount} new, ${rebasedCount} rebased, ${reprocessCount} reprocess, ` +
              `${gapFillCount} gap-fill, ${carriedOver.size} unchanged`
          )

          if (config.dryRun) {
            for (const item of workItems) {
              const tag = item._tag === "WorkItemGapFill"
                ? `gap-fill (${item.missingPlugins.join(", ")})`
                : item.reason
              yield* Effect.log(
                `  ${item.commit.abbreviatedSha} ${item.commit.subject} [${tag}]`
              )
            }
            return
          }

          if (workItems.length === 0) {
            const headSha = yield* git.getHeadSha()
            yield* store.save(
              config.outputPath,
              buildStatsFile(
                config.repoPath,
                headSha,
                pluginInfos,
                Array.from(carriedOver.values())
              )
            )
            yield* Effect.log("Nothing to process")
            return
          }

          const total = workItems.length
          const completed = yield* Ref.make(0)

          yield* Effect.log(
            `Processing ${total} items with concurrency ${config.maxConcurrency}`
          )

          const processed = yield* Effect.forEach(
            workItems,
            (item) =>
              Effect.gen(function*() {
                yield* Effect.log(
                  `  → ${item.commit.abbreviatedSha} ${item.commit.subject}`
                )
                const result = yield* Effect.scoped(processWorkItem(item, config))
                const done = yield* Ref.updateAndGet(completed, (n) => n + 1)
                yield* Effect.log(
                  `  ✓ [${done}/${total}] ${item.commit.abbreviatedSha} ${item.commit.subject}`
                )
                return result
              }),
            { concurrency: config.maxConcurrency }
          )

          const statsMap = new Map<string, CommitStats>()
          for (const [sha, stats] of carriedOver) {
            statsMap.set(sha, stats)
          }
          for (const stats of processed) {
            statsMap.set(stats.sha, stats)
          }

          const headSha = yield* git.getHeadSha()
          const finalCommits = commits.map((c) => {
            const stats = statsMap.get(c.sha)
            if (stats !== undefined) return stats
            return toCommitStats(c, null, [], {})
          })

          yield* store.save(
            config.outputPath,
            buildStatsFile(
              config.repoPath,
              headSha,
              pluginInfos,
              finalCommits
            )
          )

          yield* Effect.log("Processing complete")
        }).pipe(
          Effect.mapError(
            (err): EngineError =>
              new EngineError({
                message: err instanceof Error ? err.message : String(err),
                cause: err
              })
          )
        )

      return { run }
    })
  )
}
