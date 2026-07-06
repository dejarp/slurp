#!/usr/bin/env node
import { Command } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import * as Effect from "effect/Effect"
import { rootCommand } from "./Commands.js"

const run = rootCommand.pipe(
  Command.run({
    name: "slurp",
    version: "0.1.0"
  })
)

run(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
