import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { GitError } from "../src/errors/GitError.js"
import { PluginDiscoveryError } from "../src/errors/PluginDiscoveryError.js"
import { RenderError } from "../src/errors/RenderError.js"
import { StatsError } from "../src/errors/StatsError.js"

describe("Error Types", () => {
  describe("GitError", () => {
    it("should have correct _tag and fields", () => {
      const error = new GitError({
        command: "git log",
        message: "Failed to get commit log"
      })
      expect(error._tag).toBe("GitError")
      expect(error.command).toBe("git log")
      expect(error.message).toBe("Failed to get commit log")
    })

    it("should support optional exitCode and stderr", () => {
      const error = new GitError({
        command: "git log",
        message: "Command failed",
        exitCode: 128,
        stderr: "fatal: not a git repository"
      })
      expect(error.exitCode).toBe(128)
      expect(error.stderr).toBe("fatal: not a git repository")
    })

    it.effect("should be catchable via Effect.catchTag", () =>
      Effect.gen(function*() {
        const result = yield* Effect.fail(
          new GitError({ command: "git", message: "failed" })
        ).pipe(
          Effect.catchTag("GitError", (err) => Effect.succeed(err.command))
        )
        expect(result).toBe("git")
      }))
  })

  describe("StatsError", () => {
    it("should have correct _tag and fields", () => {
      const error = new StatsError({
        operation: "decode",
        path: "/tmp/stats.json",
        message: "Invalid JSON"
      })
      expect(error._tag).toBe("StatsError")
      expect(error.operation).toBe("decode")
      expect(error.path).toBe("/tmp/stats.json")
    })

    it.effect("should be catchable via Effect.catchTag", () =>
      Effect.gen(function*() {
        const result = yield* Effect.fail(
          new StatsError({ operation: "load", path: "/x", message: "err" })
        ).pipe(
          Effect.catchTag("StatsError", (err) => Effect.succeed(err.operation))
        )
        expect(result).toBe("load")
      }))
  })

  describe("PluginDiscoveryError", () => {
    it("should have correct _tag and fields", () => {
      const error = new PluginDiscoveryError({
        packageName: "@slurp/plugin-broken",
        message: "Failed to import"
      })
      expect(error._tag).toBe("PluginDiscoveryError")
      expect(error.packageName).toBe("@slurp/plugin-broken")
    })

    it.effect("should be catchable via Effect.catchTag", () =>
      Effect.gen(function*() {
        const result = yield* Effect.fail(
          new PluginDiscoveryError({ packageName: "bad", message: "err" })
        ).pipe(
          Effect.catchTag("PluginDiscoveryError", (err) => Effect.succeed(err.packageName))
        )
        expect(result).toBe("bad")
      }))
  })

  describe("RenderError", () => {
    it("should have correct _tag and fields", () => {
      const error = new RenderError({
        format: "csv",
        message: "Failed to render"
      })
      expect(error._tag).toBe("RenderError")
      expect(error.format).toBe("csv")
    })

    it.effect("should be catchable via Effect.catchTag", () =>
      Effect.gen(function*() {
        const result = yield* Effect.fail(
          new RenderError({ format: "csv", message: "err" })
        ).pipe(
          Effect.catchTag("RenderError", (err) => Effect.succeed(err.format))
        )
        expect(result).toBe("csv")
      }))
  })
})
