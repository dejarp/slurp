import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as nodeFs from "node:fs"
import * as nodeOs from "node:os"
import * as nodePath from "node:path"
import { afterAll, beforeAll } from "vitest"
import { PluginDiscovery } from "../src/PluginDiscovery.js"

let mockDir: string

beforeAll(() => {
  mockDir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "slurp-test-disc-"))
  const nm = nodePath.join(mockDir, "node_modules")
  nodeFs.mkdirSync(nm, { recursive: true })

  // @slurp/plugin itself (should be skipped during discovery)
  const slurpPluginDir = nodePath.join(nm, "@slurp", "plugin")
  nodeFs.mkdirSync(slurpPluginDir, { recursive: true })
  nodeFs.writeFileSync(
    nodePath.join(slurpPluginDir, "package.json"),
    JSON.stringify({
      name: "@slurp/plugin",
      version: "0.1.0",
      dependencies: { effect: "^3.0.0" }
    })
  )

  // A valid plugin candidate
  const mockPluginDir = nodePath.join(nm, "@slurp", "mock-plugin")
  nodeFs.mkdirSync(mockPluginDir, { recursive: true })
  nodeFs.writeFileSync(
    nodePath.join(mockPluginDir, "package.json"),
    JSON.stringify({
      name: "@slurp/mock-plugin",
      version: "0.1.0",
      peerDependencies: { "@slurp/plugin": "workspace:^" },
      exports: { ".": "./index.js" }
    })
  )
  nodeFs.writeFileSync(
    nodePath.join(mockPluginDir, "index.js"),
    `export default { name: "mock-plugin", version: "0.1.0", analyze: () => ({ ok: true }) }\n`
  )

  // A non-plugin package (no @slurp/plugin dep)
  const unrelatedDir = nodePath.join(nm, "unrelated-pkg")
  nodeFs.mkdirSync(unrelatedDir, { recursive: true })
  nodeFs.writeFileSync(
    nodePath.join(unrelatedDir, "package.json"),
    JSON.stringify({
      name: "unrelated-pkg",
      version: "1.0.0",
      dependencies: { lodash: "^4.0.0" }
    })
  )

  // A plugin candidate with broken import (nonexistent entry)
  const brokenDir = nodePath.join(nm, "@slurp", "broken-plugin")
  nodeFs.mkdirSync(brokenDir, { recursive: true })
  nodeFs.writeFileSync(
    nodePath.join(brokenDir, "package.json"),
    JSON.stringify({
      name: "@slurp/broken-plugin",
      version: "0.1.0",
      peerDependencies: { "@slurp/plugin": "workspace:^" },
      exports: { ".": "./nonexistent.js" }
    })
  )

  // A candidate that depends on @slurp/plugin but is NOT a plugin
  const notPluginDir = nodePath.join(nm, "@slurp", "not-a-plugin")
  nodeFs.mkdirSync(notPluginDir, { recursive: true })
  nodeFs.writeFileSync(
    nodePath.join(notPluginDir, "package.json"),
    JSON.stringify({
      name: "@slurp/not-a-plugin",
      version: "0.1.0",
      peerDependencies: { "@slurp/plugin": "workspace:^" },
      exports: { ".": "./index.js" }
    })
  )
  nodeFs.writeFileSync(
    nodePath.join(notPluginDir, "index.js"),
    `export default { someOtherThing: true }\n`
  )
})

afterAll(() => {
  nodeFs.rmSync(mockDir, { recursive: true, force: true })
})

describe.sequential("PluginDiscovery", () => {
  it.effect("discovers plugins that depend on @slurp/plugin", () =>
    Effect.gen(function*() {
      const discovery = yield* PluginDiscovery
      const plugins = yield* discovery.discover()
      const names = plugins.map((p) => p.name)
      expect(names).toContain("mock-plugin")
    }).pipe(
      Effect.provide(PluginDiscovery.Live(mockDir)),
      Effect.provide(NodeContext.layer)
    ), 30000)

  it.effect("skips @slurp/plugin itself", () =>
    Effect.gen(function*() {
      const discovery = yield* PluginDiscovery
      const plugins = yield* discovery.discover()
      const names = plugins.map((p) => p.name)
      expect(names).not.toContain("plugin")
      expect(names).not.toContain("@slurp/plugin")
    }).pipe(
      Effect.provide(PluginDiscovery.Live(mockDir)),
      Effect.provide(NodeContext.layer)
    ), 30000)

  it.effect("skips packages that do not depend on @slurp/plugin", () =>
    Effect.gen(function*() {
      const discovery = yield* PluginDiscovery
      const plugins = yield* discovery.discover()
      const names = plugins.map((p) => p.name)
      expect(names).not.toContain("unrelated-pkg")
    }).pipe(
      Effect.provide(PluginDiscovery.Live(mockDir)),
      Effect.provide(NodeContext.layer)
    ), 30000)

  it.effect("skips packages whose import fails (error isolation)", () =>
    Effect.gen(function*() {
      const discovery = yield* PluginDiscovery
      const plugins = yield* discovery.discover()
      const names = plugins.map((p) => p.name)
      expect(names).not.toContain("broken-plugin")
    }).pipe(
      Effect.provide(PluginDiscovery.Live(mockDir)),
      Effect.provide(NodeContext.layer)
    ), 30000)

  it.effect("skips packages whose export is not a valid plugin definition", () =>
    Effect.gen(function*() {
      const discovery = yield* PluginDiscovery
      const plugins = yield* discovery.discover()
      const names = plugins.map((p) => p.name)
      expect(names).not.toContain("not-a-plugin")
    }).pipe(
      Effect.provide(PluginDiscovery.Live(mockDir)),
      Effect.provide(NodeContext.layer)
    ), 30000)

  it.effect("does not error when local node_modules does not exist", () =>
    Effect.gen(function*() {
      const discovery = yield* PluginDiscovery
      const plugins = yield* discovery.discover()
      // Global plugins may be found even when local node_modules doesn't exist;
      // just verify no crash and that no local plugins leak through
      const names = plugins.map((p) => p.name)
      expect(names).not.toContain("not-a-plugin")
    }).pipe(
      Effect.provide(PluginDiscovery.Live(nodeOs.tmpdir() + "/nonexistent-slurp-test")),
      Effect.provide(NodeContext.layer)
    ), 15000)
})
