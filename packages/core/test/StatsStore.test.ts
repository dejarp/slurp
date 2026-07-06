import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import { StatsError } from "../src/errors/StatsError.js"
import { CommitStats } from "../src/schema/CommitStats.js"
import { StatsFile } from "../src/schema/StatsFile.js"
import { StatsStore } from "../src/StatsStore.js"

const makeTestStatsFile = (): StatsFile =>
  new StatsFile({
    version: "1.0.0",
    slurpVersion: "0.1.0",
    repo: { path: "/test/repo", head: "abcdef123456" },
    plugins: [{ name: "linecount", version: "0.1.0" }],
    commits: [
      new CommitStats({
        sha: "abc123",
        abbreviatedSha: "abc",
        parents: [],
        authorName: "Test",
        authorEmail: "test@test.com",
        authorDate: "2024-01-15T10:00:00Z",
        commitDate: "2024-01-15T10:05:00Z",
        subject: "Test commit",
        message: "Test commit",
        patchId: "patchhash123",
        processedPlugins: ["linecount"],
        results: { linecount: { totalLines: 100 } }
      })
    ]
  })

describe.sequential("StatsStore", () => {
  it.effect("save and load round-trip preserves data", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "stats.json")

        const original = makeTestStatsFile()
        yield* store.save(statsPath, original)

        const loaded = yield* store.load(statsPath)
        expect(Option.isSome(loaded)).toBe(true)
        if (Option.isSome(loaded)) {
          expect(loaded.value.version).toBe("1.0.0")
          expect(loaded.value.slurpVersion).toBe("0.1.0")
          expect(loaded.value.repo.path).toBe("/test/repo")
          expect(loaded.value.commits).toHaveLength(1)
          expect(loaded.value.commits[0].sha).toBe("abc123")
          expect(loaded.value.commits[0].patchId).toBe("patchhash123")
          expect(loaded.value.commits[0].processedPlugins).toEqual(["linecount"])
        }
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("load returns Option.none for non-existent file", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "nonexistent.json")

        const result = yield* store.load(statsPath)
        expect(Option.isNone(result)).toBe(true)
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("load returns StatsError for invalid JSON", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "bad.json")

        yield* fs.writeFileString(statsPath, "{ this is not valid json }")

        const result = yield* Effect.either(store.load(statsPath))
        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(StatsError)
          expect(result.left.operation).toBe("decode")
        }
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("load returns StatsError for schema-invalid JSON", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "invalid.json")

        yield* fs.writeFileString(
          statsPath,
          JSON.stringify({ version: "1.0.0", missing: "fields" })
        )

        const result = yield* Effect.either(store.load(statsPath))
        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(StatsError)
          expect(result.left.operation).toBe("decode")
        }
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("save removes lock file on successful completion", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "stats.json")
        const lockPath = `${statsPath}.lock`

        yield* store.save(statsPath, makeTestStatsFile())

        const lockExists = yield* fs.exists(lockPath)
        expect(lockExists).toBe(false)
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("save fails when lock file already exists", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "stats.json")
        const lockPath = `${statsPath}.lock`

        yield* fs.writeFileString(lockPath, "existing lock")

        const result = yield* Effect.either(
          store.save(statsPath, makeTestStatsFile())
        )
        expect(result._tag).toBe("Left")
        if (result._tag === "Left") {
          expect(result.left).toBeInstanceOf(StatsError)
          expect(result.left.operation).toBe("save")
          expect(result.left.message).toContain("lock")
        }
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("removeStaleLock removes an existing lock file", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "stats.json")
        const lockPath = `${statsPath}.lock`

        yield* fs.writeFileString(lockPath, "stale lock")

        yield* store.removeStaleLock(statsPath)

        const lockExists = yield* fs.exists(lockPath)
        expect(lockExists).toBe(false)
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("removeStaleLock succeeds when no lock file exists", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "stats.json")

        yield* store.removeStaleLock(statsPath)
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)

  it.effect("save writes valid JSON that can be parsed", () =>
    Effect.scoped(
      Effect.gen(function*() {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const store = yield* StatsStore

        const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "slurp-test-" })
        const statsPath = path.join(tempDir, "stats.json")

        yield* store.save(statsPath, makeTestStatsFile())

        const content = yield* fs.readFileString(statsPath)
        const parsed = JSON.parse(content)
        expect(parsed.version).toBe("1.0.0")
        expect(parsed.commits[0].sha).toBe("abc123")
      })
    ).pipe(
      Effect.provide(StatsStore.Live),
      Effect.provide(NodeContext.layer)
    ), 15000)
})
