import type { PluginError } from "@slurp/plugin"

export interface PluginResultSuccess {
  readonly _tag: "PluginResultSuccess"
  readonly pluginName: string
  readonly result: unknown
}

export interface PluginResultFailure {
  readonly _tag: "PluginResultFailure"
  readonly pluginName: string
  readonly error: PluginError
}

export type PluginResult = PluginResultSuccess | PluginResultFailure
