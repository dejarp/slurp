import { Engine, GitService, PluginDiscovery, PluginRegistry, StatsStore, WorktreeManager } from "@slurp/core"
import * as Layer from "effect/Layer"

export const buildMainLayer = (repoPath: string) =>
  Engine.Live.pipe(
    Layer.provide(
      Layer.mergeAll(
        PluginRegistry.Live.pipe(Layer.provide(PluginDiscovery.Live(repoPath))),
        WorktreeManager.Live.pipe(Layer.provide(GitService.Live(repoPath))),
        GitService.Live(repoPath),
        StatsStore.Live
      )
    )
  )
