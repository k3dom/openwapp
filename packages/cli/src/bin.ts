#!/usr/bin/env node
import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Effect } from 'effect'
import { Command } from 'effect/cli'

import * as Cli from '#/cli.ts'

import packageJson from '../package.json' with { type: 'json' }

Command.run(Cli.command, { version: packageJson.version }).pipe(
  Effect.provide(NodeServices.layer),
  NodeRuntime.runMain
)
