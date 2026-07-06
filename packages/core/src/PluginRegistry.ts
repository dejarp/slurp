import type { AnalyzeContext, SlurpPluginDefinition } from "@slurp/plugin"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Either from "effect/Either"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { PluginDiscovery } from "./PluginDiscovery.js"
import type { PluginResult } from "./PluginResult.js"

const runPluginList = (
  pluginList: ReadonlyArray<SlurpPluginDefinition>,
  ctx: AnalyzeContext
): Effect.Effect<ReadonlyArray<PluginResult>, never> =>
  Effect.forEach(
    pluginList,
    (plugin) =>
      plugin.analyze(ctx).pipe(
        Effect.either,
        Effect.map(
          Either.match({
            onLeft: (error): PluginResult => ({
              _tag: "PluginResultFailure",
              pluginName: plugin.name,
              error
            }),
            onRight: (result): PluginResult => ({
              _tag: "PluginResultSuccess",
              pluginName: plugin.name,
              result
            })
          })
        )
      ),
    { concurrency: "unbounded" }
  )

export interface PluginRegistryShape {
  readonly plugins: ReadonlyArray<SlurpPluginDefinition>
  readonly pluginNames: ReadonlyArray<string>
  readonly getPlugin: (name: string) => Option.Option<SlurpPluginDefinition>
  readonly runAllPlugins: (ctx: AnalyzeContext) => Effect.Effect<ReadonlyArray<PluginResult>, never>
  readonly runPlugins: (
    names: ReadonlyArray<string>,
    ctx: AnalyzeContext
  ) => Effect.Effect<ReadonlyArray<PluginResult>, never>
}

const makeRegistry = (
  discoveredPlugins: ReadonlyArray<SlurpPluginDefinition>
): PluginRegistryShape => {
  const plugins = [...discoveredPlugins]
  const pluginMap = new Map(plugins.map((p) => [p.name, p]))

  return {
    plugins,
    pluginNames: plugins.map((p) => p.name),

    getPlugin: (name: string) => Option.fromNullable(pluginMap.get(name)),

    runAllPlugins: (ctx: AnalyzeContext) => runPluginList(plugins, ctx),

    runPlugins: (names: ReadonlyArray<string>, ctx: AnalyzeContext) => {
      const nameSet = new Set(names)
      const filtered = plugins.filter((p) => nameSet.has(p.name))
      return runPluginList(filtered, ctx)
    }
  }
}

export class PluginRegistry extends Context.Tag("PluginRegistry")<
  PluginRegistry,
  PluginRegistryShape
>() {
  static Live = Layer.effect(
    PluginRegistry,
    Effect.gen(function*() {
      const discovery = yield* PluginDiscovery
      const plugins = yield* discovery.discover()
      return makeRegistry(plugins)
    })
  )

  static fromPlugins = (
    plugins: ReadonlyArray<SlurpPluginDefinition>
  ): Layer.Layer<PluginRegistry> => Layer.succeed(PluginRegistry, makeRegistry(plugins))
}
