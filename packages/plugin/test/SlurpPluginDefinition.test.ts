import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import type { AnalyzeContext } from "../src/AnalyzeContext.js"
import { CommitInfo } from "../src/CommitInfo.js"
import { PluginError } from "../src/PluginError.js"
import { definePlugin } from "../src/SlurpPluginDefinition.js"

describe("SlurpPluginDefinition", () => {
  it("definePlugin should return the definition as-is", () => {
    const plugin = definePlugin({
      name: "test-plugin",
      version: "1.0.0",
      analyze: () => Effect.succeed({ result: 42 })
    })
    expect(plugin.name).toBe("test-plugin")
    expect(plugin.version).toBe("1.0.0")
  })

  it.effect("plugin analyze should return a result", () =>
    Effect.gen(function*() {
      const plugin = definePlugin({
        name: "test-plugin",
        version: "1.0.0",
        analyze: () => Effect.succeed({ count: 100 })
      })
      const result = yield* plugin.analyze({} as AnalyzeContext)
      expect(result).toEqual({ count: 100 })
    }))

  it.effect("plugin analyze should fail with PluginError", () =>
    Effect.gen(function*() {
      const plugin = definePlugin({
        name: "failing-plugin",
        version: "1.0.0",
        analyze: () =>
          Effect.fail(
            new PluginError({
              pluginName: "failing-plugin",
              message: "intentional failure"
            })
          )
      })
      const result = yield* Effect.either(plugin.analyze({} as AnalyzeContext))
      expect(result._tag).toBe("Left")
    }))
})

describe("CommitInfo", () => {
  it.effect("should encode/decode JSON round-trip", () =>
    Effect.gen(function*() {
      const commit = new CommitInfo({
        sha: "abc123def456",
        abbreviatedSha: "abc123d",
        parents: ["parent1", "parent2"],
        authorName: "John Doe",
        authorEmail: "john@example.com",
        authorDate: "2024-01-15T10:00:00Z",
        commitDate: "2024-01-15T10:05:00Z",
        subject: "Fix bug",
        message: "Fix bug\n\nDetailed description"
      })
      const encoded = yield* Schema.encode(CommitInfo)(commit)
      const decoded = yield* Schema.decode(CommitInfo)(encoded)
      expect(decoded.sha).toBe("abc123def456")
      expect(decoded.parents).toEqual(["parent1", "parent2"])
      expect(decoded.subject).toBe("Fix bug")
    }))
})
