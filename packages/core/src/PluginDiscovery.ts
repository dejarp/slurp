import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import type { SlurpPluginDefinition } from "@slurp/plugin"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import { PluginDiscoveryError } from "./errors/PluginDiscoveryError.js"

const PLUGIN_SDK_PACKAGE = "@slurp/plugin"

const DEP_SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
] as const

const toFileUrl = (p: string): string => p.startsWith("/") ? `file://${p}` : `file:///${p}`

interface CandidatePackage {
  readonly name: string
  readonly dir: string
  readonly entryPath: string
}

const hasSlurpPluginDep = (pkg: Record<string, unknown>): boolean =>
  DEP_SECTIONS.some((section) => {
    const deps = pkg[section]
    return typeof deps === "object" && deps !== null && PLUGIN_SDK_PACKAGE in deps
  })

const resolveEntry = (
  pkgDir: string,
  pkg: Record<string, unknown>,
  path: Path.Path
): string => {
  const exports = pkg["exports"]
  if (typeof exports === "string") {
    return path.isAbsolute(exports) ? exports : path.join(pkgDir, exports)
  }
  if (typeof exports === "object" && exports !== null) {
    const dotExport = (exports as Record<string, unknown>)["."]
    if (typeof dotExport === "string") {
      return path.isAbsolute(dotExport) ? dotExport : path.join(pkgDir, dotExport)
    }
    if (typeof dotExport === "object" && dotExport !== null) {
      const obj = dotExport as Record<string, unknown>
      for (const key of ["import", "default"]) {
        const val = obj[key]
        if (typeof val === "string") {
          return path.isAbsolute(val) ? val : path.join(pkgDir, val)
        }
      }
    }
  }
  for (const field of ["module", "main"] as const) {
    const val = pkg[field]
    if (typeof val === "string") {
      return path.isAbsolute(val) ? val : path.join(pkgDir, val)
    }
  }
  return path.join(pkgDir, "index.js")
}

const isPluginDefinition = (value: unknown): value is SlurpPluginDefinition => {
  if (typeof value !== "object" || value === null) return false
  const def = value as Record<string, unknown>
  return typeof def["name"] === "string" &&
    typeof def["version"] === "string" &&
    typeof def["analyze"] === "function"
}

const scanNodeModules = (
  nodeModulesPath: string,
  fs: FileSystem.FileSystem,
  path: Path.Path
): Effect.Effect<ReadonlyArray<CandidatePackage>, PluginDiscoveryError> =>
  Effect.gen(function*() {
    const exists = yield* fs.exists(nodeModulesPath).pipe(
      Effect.catchAll(() => Effect.succeed(false))
    )
    if (!exists) return []

    const topEntries = yield* fs.readDirectory(nodeModulesPath).pipe(
      Effect.mapError((err) =>
        new PluginDiscoveryError({
          packageName: "(node_modules)",
          message: `Failed to read ${nodeModulesPath}: ${err.message}`
        })
      )
    )

    const packageDirs: Array<{ name: string; dir: string }> = []

    yield* Effect.forEach(
      topEntries,
      (entry) =>
        Effect.gen(function*() {
          if (entry.startsWith(".")) return

          const fullPath = path.join(nodeModulesPath, entry)

          if (entry.startsWith("@")) {
            const stat = yield* fs.stat(fullPath).pipe(
              Effect.map((s) => s.type === "Directory"),
              Effect.catchAll(() => Effect.succeed(false))
            )
            if (!stat) return

            const scopedEntries = yield* fs.readDirectory(fullPath).pipe(
              Effect.mapError((err) =>
                new PluginDiscoveryError({
                  packageName: entry,
                  message: `Failed to read scoped directory: ${err.message}`
                })
              )
            )

            for (const scopedEntry of scopedEntries) {
              if (scopedEntry.startsWith(".")) continue
              packageDirs.push({
                name: `${entry}/${scopedEntry}`,
                dir: path.join(fullPath, scopedEntry)
              })
            }
          } else {
            packageDirs.push({ name: entry, dir: fullPath })
          }
        }),
      { concurrency: "unbounded" }
    )

    const candidates: Array<CandidatePackage> = []

    yield* Effect.forEach(
      packageDirs,
      (pkgDir) =>
        Effect.gen(function*() {
          const pkgJsonPath = path.join(pkgDir.dir, "package.json")

          const pkgExists = yield* fs.exists(pkgJsonPath).pipe(
            Effect.catchAll(() => Effect.succeed(false))
          )
          if (!pkgExists) return

          const content = yield* fs.readFileString(pkgJsonPath).pipe(
            Effect.mapError((err) =>
              new PluginDiscoveryError({
                packageName: pkgDir.name,
                message: `Failed to read package.json: ${err.message}`
              })
            )
          )

          let pkg: Record<string, unknown>
          try {
            pkg = JSON.parse(content) as Record<string, unknown>
          } catch {
            return
          }

          if (pkg["name"] === PLUGIN_SDK_PACKAGE) return

          if (!hasSlurpPluginDep(pkg)) return

          const entryPath = resolveEntry(pkgDir.dir, pkg, path)

          candidates.push({ name: pkgDir.name, dir: pkgDir.dir, entryPath })
        }),
      { concurrency: "unbounded" }
    )

    return candidates
  })

const importPlugin = (
  candidate: CandidatePackage
): Effect.Effect<Option.Option<SlurpPluginDefinition>, PluginDiscoveryError> =>
  Effect.gen(function*() {
    const fileUrl = toFileUrl(candidate.entryPath)

    const mod = yield* Effect.tryPromise({
      try: () => import(fileUrl),
      catch: (err) =>
        new PluginDiscoveryError({
          packageName: candidate.name,
          message: `Failed to import plugin: ${err instanceof Error ? err.message : String(err)}`,
          cause: err
        })
    })

    const defaultExport = (mod as { default?: unknown }).default

    if (!isPluginDefinition(defaultExport)) {
      return Option.none()
    }

    return Option.some(defaultExport)
  })

const deduplicateByName = (
  candidates: ReadonlyArray<CandidatePackage>
): ReadonlyArray<CandidatePackage> => {
  const seen = new Set<string>()
  const result: Array<CandidatePackage> = []
  for (const c of candidates) {
    if (!seen.has(c.name)) {
      seen.add(c.name)
      result.push(c)
    }
  }
  return result
}

export interface PluginDiscoveryShape {
  readonly discover: () => Effect.Effect<ReadonlyArray<SlurpPluginDefinition>, PluginDiscoveryError>
}

export class PluginDiscovery extends Context.Tag("PluginDiscovery")<
  PluginDiscovery,
  PluginDiscoveryShape
>() {
  static Live = (
    repoPath: string
  ): Layer.Layer<
    PluginDiscovery,
    never,
    FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
  > => Layer.effect(PluginDiscovery, makePluginDiscovery(repoPath))
}

const makePluginDiscovery = (
  repoPath: string
): Effect.Effect<
  PluginDiscoveryShape,
  never,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> =>
  Effect.gen(function*() {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const executor = yield* CommandExecutor.CommandExecutor

    const getGlobalNodeModules = executor
      .string(Command.make("npm", "root", "-g"))
      .pipe(
        Effect.map((s) => s.trim()),
        Effect.catchAll(() => Effect.succeed(""))
      )

    return {
      discover: () =>
        Effect.gen(function*() {
          const globalRoot = yield* getGlobalNodeModules
          const localNodeModules = path.join(repoPath, "node_modules")

          const globalCandidates = globalRoot.length > 0
            ? yield* scanNodeModules(globalRoot, fs, path)
            : []
          const localCandidates = yield* scanNodeModules(localNodeModules, fs, path)

          const allCandidates = deduplicateByName([...globalCandidates, ...localCandidates])

          if (globalCandidates.length > 0 || localCandidates.length > 0) {
            yield* Effect.log(
              `Scanning for plugins: ${globalCandidates.length} global, ${localCandidates.length} local`
            )
          }

          const results = yield* Effect.forEach(
            allCandidates,
            (candidate) =>
              importPlugin(candidate).pipe(
                Effect.catchAll((err) =>
                  Effect.gen(function*() {
                    yield* Effect.logWarning(
                      `Skipping plugin ${candidate.name}: ${err.message}`
                    )
                    return Option.none() as Option.Option<SlurpPluginDefinition>
                  })
                )
              ),
            { concurrency: "unbounded" }
          )

          return results.filter(Option.isSome).map((r) => r.value)
        })
    }
  })
