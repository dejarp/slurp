import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Schema from "effect/Schema"
import { StatsError } from "./errors/StatsError.js"
import { StatsFile } from "./schema/StatsFile.js"

const toStatsError = (
  operation: StatsError["operation"],
  path: string,
  err: unknown
): StatsError =>
  new StatsError({
    operation,
    path,
    message: err instanceof Error ? err.message : String(err),
    cause: err
  })

export interface StatsStoreShape {
  readonly load: (path: string) => Effect.Effect<Option.Option<StatsFile>, StatsError>
  readonly save: (path: string, stats: StatsFile) => Effect.Effect<void, StatsError>
  readonly removeStaleLock: (path: string) => Effect.Effect<void, StatsError>
}

export class StatsStore extends Context.Tag("StatsStore")<StatsStore, StatsStoreShape>() {
  static Live = Layer.effect(
    StatsStore,
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      return {
        load: (filePath: string) =>
          Effect.gen(function*() {
            const exists = yield* fs.exists(filePath).pipe(
              Effect.mapError((err) => toStatsError("load", filePath, err))
            )
            if (!exists) {
              return Option.none()
            }

            const content = yield* fs.readFileString(filePath).pipe(
              Effect.mapError((err) => toStatsError("load", filePath, err))
            )

            const json = yield* Effect.try({
              try: () => JSON.parse(content) as unknown,
              catch: (err) => toStatsError("decode", filePath, err)
            })

            const decoded = yield* Schema.decodeUnknown(StatsFile)(json).pipe(
              Effect.mapError((err) => toStatsError("decode", filePath, err))
            )

            return Option.some(decoded)
          }),

        save: (filePath: string, stats: StatsFile) =>
          Effect.gen(function*() {
            const lockPath = `${filePath}.lock`

            const lockExists = yield* fs.exists(lockPath).pipe(
              Effect.mapError((err) => toStatsError("save", filePath, err))
            )
            if (lockExists) {
              yield* Effect.fail(
                new StatsError({
                  operation: "save",
                  path: filePath,
                  message: `Another slurp instance is writing to this file. ` +
                    `If no other instance is running, remove the lock file at ${lockPath}.`
                })
              )
            }

            yield* Effect.gen(function*() {
              yield* fs.writeFileString(lockPath, "").pipe(
                Effect.mapError((err) => toStatsError("save", filePath, err))
              )

              const encoded = yield* Schema.encode(StatsFile)(stats).pipe(
                Effect.mapError((err) => toStatsError("save", filePath, err))
              )
              const json = JSON.stringify(encoded, null, 2)

              const dir = path.dirname(filePath)
              const tempFile = yield* fs
                .makeTempFile({ directory: dir, prefix: "slurp-stats-" })
                .pipe(
                  Effect.mapError((err) => toStatsError("save", filePath, err))
                )

              yield* fs.writeFileString(tempFile, json).pipe(
                Effect.mapError((err) => toStatsError("save", filePath, err))
              )

              yield* fs.rename(tempFile, filePath).pipe(
                Effect.mapError((err) => toStatsError("save", filePath, err))
              )
            }).pipe(
              Effect.ensuring(
                fs.remove(lockPath, { force: true }).pipe(Effect.ignore)
              )
            )
          }),

        removeStaleLock: (filePath: string) =>
          fs.remove(`${filePath}.lock`, { force: true }).pipe(
            Effect.mapError((err) => toStatsError("save", filePath, err))
          )
      }
    })
  )
}
