import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { CommitStats } from "../src/schema/CommitStats.js"
import { StatsFile } from "../src/schema/StatsFile.js"

describe("CommitStats", () => {
  it.effect("should encode/decode JSON round-trip", () =>
    Effect.gen(function*() {
      const stats = new CommitStats({
        sha: "abc123def456",
        abbreviatedSha: "abc123d",
        parents: ["parent1"],
        authorName: "John Doe",
        authorEmail: "john@example.com",
        authorDate: "2024-01-15T10:00:00Z",
        commitDate: "2024-01-15T10:05:00Z",
        subject: "Fix bug",
        message: "Fix bug\n\nDetailed description",
        patchId: "abc123hash",
        processedPlugins: ["linecount"],
        results: { linecount: { totalLines: 100, byExtension: { ".ts": 100 } } }
      })
      const encoded = yield* Schema.encode(CommitStats)(stats)
      const decoded = yield* Schema.decode(CommitStats)(encoded)
      expect(decoded.sha).toBe("abc123def456")
      expect(decoded.parents).toEqual(["parent1"])
      expect(decoded.patchId).toBe("abc123hash")
      expect(decoded.processedPlugins).toEqual(["linecount"])
      expect((decoded.results as Record<string, unknown>).linecount).toBeDefined()
    }))

  it.effect("should support null patchId", () =>
    Effect.gen(function*() {
      const stats = new CommitStats({
        sha: "abc123",
        abbreviatedSha: "abc",
        parents: [],
        authorName: "A",
        authorEmail: "a@b.com",
        authorDate: "2024-01-15T10:00:00Z",
        commitDate: "2024-01-15T10:05:00Z",
        subject: "S",
        message: "M",
        patchId: null,
        processedPlugins: [],
        results: {}
      })
      const encoded = yield* Schema.encode(CommitStats)(stats)
      const decoded = yield* Schema.decode(CommitStats)(encoded)
      expect(decoded.patchId).toBeNull()
      expect(decoded.processedPlugins).toEqual([])
    }))
})

describe("StatsFile", () => {
  const plainJson = {
    version: "1.0.0",
    slurpVersion: "0.1.0",
    repo: { path: "/repo", head: "abcdef123456" },
    plugins: [{ name: "linecount", version: "0.1.0" }],
    commits: [{
      sha: "abc123",
      abbreviatedSha: "abc",
      parents: [],
      authorName: "A",
      authorEmail: "a@b.com",
      authorDate: "2024-01-15T10:00:00Z",
      commitDate: "2024-01-15T10:05:00Z",
      subject: "S",
      message: "M",
      patchId: "hash123",
      processedPlugins: ["linecount"],
      results: { linecount: { totalLines: 50 } }
    }]
  }

  it.effect("should decode plain JSON (from disk) into StatsFile instance", () =>
    Effect.gen(function*() {
      const decoded = yield* Schema.decodeUnknown(StatsFile)(plainJson)
      expect(decoded.version).toBe("1.0.0")
      expect(decoded.slurpVersion).toBe("0.1.0")
      expect(decoded.repo.path).toBe("/repo")
      expect(decoded.repo.head).toBe("abcdef123456")
      expect(decoded.plugins).toEqual([{ name: "linecount", version: "0.1.0" }])
      expect(decoded.commits).toHaveLength(1)
      expect(decoded.commits[0].sha).toBe("abc123")
      expect(decoded.commits[0].processedPlugins).toEqual(["linecount"])
    }))

  it.effect("should encode/decode full round-trip via decodeUnknown", () =>
    Effect.gen(function*() {
      const decoded = yield* Schema.decodeUnknown(StatsFile)(plainJson)
      const encoded = yield* Schema.encode(StatsFile)(decoded)
      const reDecoded = yield* Schema.decodeUnknown(StatsFile)(encoded)
      expect(reDecoded.version).toBe("1.0.0")
      expect(reDecoded.commits[0].sha).toBe("abc123")
    }))

  it.effect("should handle empty commits array", () =>
    Effect.gen(function*() {
      const decoded = yield* Schema.decodeUnknown(StatsFile)({
        version: "1.0.0",
        slurpVersion: "0.1.0",
        repo: { path: "/repo", head: "abc" },
        plugins: [],
        commits: []
      })
      expect(decoded.commits).toEqual([])
    }))
})
