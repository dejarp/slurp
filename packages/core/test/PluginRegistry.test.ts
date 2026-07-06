import { describe, expect, it } from "@effect/vitest"
import { type AnalyzeContext, definePlugin, PluginError } from "@slurp/plugin"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { PluginRegistry } from "../src/PluginRegistry.js"
import type { PluginResult } from "../src/PluginResult.js"

const mockContext: AnalyzeContext = {
  worktreePath: "/fake/worktree",
  repoPath: "/fake/repo",
  commit: {
    sha: "abc123",
    abbreviatedSha: "abc",
    parents: [],
    authorName: "Test",
    authorEmail: "test@test.com",
    authorDate: "2024-01-15T10:00:00Z",
    commitDate: "2024-01-15T10:00:00Z",
    subject: "Test",
    message: "Test"
  }
}

const successPlugin = definePlugin({
  name: "success-plugin",
  version: "0.1.0",
  analyze: () => Effect.succeed({ count: 42 })
})

const failPlugin = definePlugin({
  name: "fail-plugin",
  version: "0.1.0",
  analyze: () =>
    Effect.fail(
      new PluginError({
        pluginName: "fail-plugin",
        message: "Intentional failure"
      })
    )
})

describe("PluginRegistry", () => {
  it.effect("runAllPlugins runs all registered plugins", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      const results = yield* registry.runAllPlugins(mockContext)

      expect(results).toHaveLength(2)
      const names = results.map((r) => r.pluginName)
      expect(names).toContain("success-plugin")
      expect(names).toContain("fail-plugin")
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin, failPlugin])
      )
    ))

  it.effect("a failing plugin does not stop other plugins (error isolation)", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      const results = yield* registry.runAllPlugins(mockContext)

      const successResult = results.find(
        (r): r is PluginResult & { _tag: "PluginResultSuccess" } =>
          r.pluginName === "success-plugin" && r._tag === "PluginResultSuccess"
      )
      const failResult = results.find(
        (r): r is PluginResult & { _tag: "PluginResultFailure" } =>
          r.pluginName === "fail-plugin" && r._tag === "PluginResultFailure"
      )

      expect(successResult).toBeDefined()
      expect(successResult!.result).toEqual({ count: 42 })

      expect(failResult).toBeDefined()
      expect(failResult!.error.message).toBe("Intentional failure")
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin, failPlugin])
      )
    ))

  it.effect("runPlugins runs only the specified subset", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      const results = yield* registry.runPlugins(["success-plugin"], mockContext)

      expect(results).toHaveLength(1)
      expect(results[0].pluginName).toBe("success-plugin")
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin, failPlugin])
      )
    ))

  it.effect("getPlugin returns Some for existing plugin", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      const plugin = registry.getPlugin("success-plugin")
      expect(Option.isSome(plugin)).toBe(true)
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin])
      )
    ))

  it.effect("getPlugin returns None for non-existent plugin", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      const plugin = registry.getPlugin("nonexistent")
      expect(Option.isNone(plugin)).toBe(true)
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin])
      )
    ))

  it.effect("pluginNames lists all registered plugin names", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      expect(registry.pluginNames).toEqual(["success-plugin", "fail-plugin"])
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin, failPlugin])
      )
    ))

  it.effect("runPlugins with empty names returns empty results", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      const results = yield* registry.runPlugins([], mockContext)
      expect(results).toHaveLength(0)
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin, failPlugin])
      )
    ))

  it.effect("runPlugins with unknown names returns empty results", () =>
    Effect.gen(function*() {
      const registry = yield* PluginRegistry

      const results = yield* registry.runPlugins(["nonexistent"], mockContext)
      expect(results).toHaveLength(0)
    }).pipe(
      Effect.provide(
        PluginRegistry.fromPlugins([successPlugin])
      )
    ))
})
