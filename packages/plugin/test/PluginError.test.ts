import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { PluginError } from "../src/PluginError.js"

describe("PluginError", () => {
  it("should have correct _tag", () => {
    const error = new PluginError({
      pluginName: "test-plugin",
      message: "Something went wrong"
    })
    expect(error._tag).toBe("PluginError")
    expect(error.pluginName).toBe("test-plugin")
    expect(error.message).toBe("Something went wrong")
  })

  it("should support optional cause field", () => {
    const cause = new Error("root cause")
    const error = new PluginError({
      pluginName: "test-plugin",
      message: "Something went wrong",
      cause
    })
    expect(error.cause).toBe(cause)
  })

  it.effect("should be catchable via Effect.catchTag", () =>
    Effect.gen(function*() {
      const result = yield* Effect.fail(
        new PluginError({
          pluginName: "test-plugin",
          message: "failed"
        })
      ).pipe(
        Effect.catchTag("PluginError", (err) => Effect.succeed(err.pluginName))
      )
      expect(result).toBe("test-plugin")
    }))

  it.effect("should encode/decode JSON round-trip", () =>
    Effect.gen(function*() {
      const error = new PluginError({
        pluginName: "test-plugin",
        message: "Something went wrong"
      })
      const encoded = yield* Schema.encode(PluginError)(error)
      const decoded = yield* Schema.decode(PluginError)(encoded)
      expect(decoded._tag).toBe("PluginError")
      expect(decoded.pluginName).toBe("test-plugin")
      expect(decoded.message).toBe("Something went wrong")
    }))
})
