import { createServer, type RequestListener } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'

import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { ConfigProvider, Effect, FileSystem, Layer, Path } from 'effect'
import { Command } from 'effect/cli'
import { TestConsole } from 'effect/testing'

import * as Cli from '#/cli.ts'

const fingerprints = fileURLToPath(
  new URL('fixtures/fingerprints', import.meta.url)
)

const TestLayer = Layer.mergeAll(NodeServices.layer, TestConsole.layer)

const run = (...args: ReadonlyArray<string>) =>
  Command.runWith(Cli.command, { version: '0.0.0' })(args)

const serve = (listener: RequestListener) =>
  Effect.acquireRelease(
    Effect.promise(async () => {
      const server = createServer(listener)
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve)
      )
      return server
    }),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections()
            server.close(() => resolve())
          })
      )
  ).pipe(
    Effect.map(
      (server) => `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
    )
  )

const acme = (_: unknown, response: Parameters<RequestListener>[1]) =>
  response
    .setHeader('x-powered-by', 'AcmeCMS/2.1')
    .end('<html><script src="/beta.js"></script></html>')

describe('detect', () => {
  it.live('prints the technologies of a site with their categories', () =>
    Effect.gen(function* () {
      const url = yield* serve(acme)
      yield* run('detect', '--fingerprints', fingerprints, url)
      expect(yield* TestConsole.logLines).toEqual([
        [
          url,
          '  Acme CMS 2.1          CMS',
          '  Acme Language         Programming languages',
          '  Beta Analytics (50%)  Analytics',
        ].join('\n'),
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('says when nothing was detected', () =>
    Effect.gen(function* () {
      const url = yield* serve((_, response) => response.end())
      yield* run('detect', '-f', fingerprints, url)
      expect(yield* TestConsole.logLines).toEqual([
        `${url}\n  No technologies detected`,
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('prints one JSON object per site with --json', () =>
    Effect.gen(function* () {
      const first = yield* serve(acme)
      const second = yield* serve((_, response) => response.end())
      yield* run('detect', '-f', fingerprints, '--json', first, second)
      const lines = yield* TestConsole.logLines
      expect(lines.map((line) => JSON.parse(String(line)) as unknown)).toEqual(
        expect.arrayContaining([
          {
            url: first,
            finalUrl: first,
            technologies: [
              {
                name: 'Acme CMS',
                version: '2.1',
                confidence: 100,
                categories: ['CMS'],
                website: 'https://acme.example',
                description: 'A content management system.',
              },
              {
                name: 'Acme Language',
                confidence: 100,
                categories: ['Programming languages'],
                website: 'https://acme.example/language',
              },
              {
                name: 'Beta Analytics',
                confidence: 50,
                categories: ['Analytics'],
                website: 'https://beta.example',
              },
            ],
          },
          { url: second, finalUrl: second, technologies: [] },
        ])
      )
      expect(lines).toHaveLength(2)
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('sends the given headers', () =>
    Effect.gen(function* () {
      const received: Array<unknown> = []
      const url = yield* serve((request, response) => {
        received.push(request.headers)
        response.end()
      })
      yield* run(
        'detect',
        '-f',
        fingerprints,
        '-H',
        'User-Agent: openwapp',
        '--header',
        'x-scan:  1 ',
        url
      )
      expect(received).toEqual([
        expect.objectContaining({ 'user-agent': 'openwapp', 'x-scan': '1' }),
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('rejects a header without a colon', () =>
    Effect.gen(function* () {
      const error = yield* run(
        'detect',
        '-f',
        fingerprints,
        '-H',
        'user-agent',
        'http://127.0.0.1/'
      ).pipe(Effect.flip)
      expect(error._tag).toBe('ShowHelp')
      expect(yield* TestConsole.errorLines).toEqual([
        expect.stringContaining(
          'Expected a header as "name: value", got "user-agent"'
        ),
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('rejects a timeout or concurrency below 1', () =>
    Effect.gen(function* () {
      for (const flag of ['--timeout', '--lookup-timeout', '--concurrency']) {
        const error = yield* run(
          'detect',
          '-f',
          fingerprints,
          flag,
          '0',
          'example.com'
        ).pipe(Effect.flip)
        expect(error._tag).toBe('ShowHelp')
      }
      expect(yield* TestConsole.errorLines).toEqual([
        expect.stringContaining(
          'Invalid value for flag --timeout: "0". Expected a positive number of seconds, got 0'
        ),
        expect.stringContaining(
          'Invalid value for flag --lookup-timeout: "0". Expected a positive number of seconds, got 0'
        ),
        expect.stringContaining(
          'Invalid value for flag --concurrency: "0". Expected a positive number, got 0'
        ),
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('reports the sites it could not load after the others', () =>
    Effect.gen(function* () {
      const url = yield* serve(acme)
      const error = yield* run(
        'detect',
        '-f',
        fingerprints,
        '--json',
        url,
        '127.0.0.1:1'
      ).pipe(Effect.flip)
      expect(error.message).toBe(
        'Could not load https://127.0.0.1:1/: bad port'
      )
      const lines = (yield* TestConsole.logLines).map(
        (line) => JSON.parse(String(line)) as unknown
      )
      expect(lines).toHaveLength(2)
      expect(lines).toContainEqual(expect.objectContaining({ url }))
      expect(lines).toContainEqual({
        url: 'https://127.0.0.1:1',
        error: 'Could not load https://127.0.0.1:1/: bad port',
      })
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('gives up on a page that takes longer than --timeout', () =>
    Effect.gen(function* () {
      const url = yield* serve(() => {})
      const error = yield* run(
        'detect',
        '-f',
        fingerprints,
        '--timeout',
        '0.1',
        url
      ).pipe(Effect.flip)
      expect(error.message).toBe(
        `Could not load ${url}: timed out after 0.1 seconds`
      )
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('loads the fingerprints of $OPENWAPP_FINGERPRINTS', () =>
    Effect.gen(function* () {
      const url = yield* serve(acme)
      yield* run('detect', url).pipe(
        Effect.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({
              env: { OPENWAPP_FINGERPRINTS: fingerprints },
            })
          )
        )
      )
      expect(yield* TestConsole.logLines).toEqual([
        expect.stringContaining('Acme CMS 2.1'),
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('loads the fingerprints from a single JSON file', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const read = (file: string) =>
        fs
          .readFileString(path.join(fingerprints, file))
          .pipe(Effect.map((text) => JSON.parse(text) as object))
      const file = path.join(
        yield* fs.makeTempDirectoryScoped(),
        'fingerprints.json'
      )
      yield* fs.writeFileString(
        file,
        JSON.stringify({
          technologies: {
            ...(yield* read('technologies/a.json')),
            ...(yield* read('technologies/b.json')),
          },
          categories: yield* read('categories.json'),
          groups: yield* read('groups.json'),
        })
      )
      const url = yield* serve(acme)
      yield* run('detect', '-f', file, url)
      expect(yield* TestConsole.logLines).toEqual([
        expect.stringContaining('Acme CMS 2.1'),
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('loads the upstream fingerprints', () =>
    Effect.gen(function* () {
      const url = yield* serve((_, response) =>
        response
          .setHeader('content-type', 'text/html')
          .end('<html><head><meta name="generator" content="WordPress 6.5">')
      )
      yield* run(
        'detect',
        '-f',
        fileURLToPath(
          new URL(
            '.',
            import.meta.resolve('@openwapp/fingerprints/groups.json')
          )
        ),
        url
      )
      expect(yield* TestConsole.logLines).toEqual([
        expect.stringMatching(/^ {2}WordPress 6\.5 +CMS, Blogs$/m),
      ])
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('fails with the issues of invalid fingerprints', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const file = path.join(
        yield* fs.makeTempDirectoryScoped(),
        'fingerprints.json'
      )
      yield* fs.writeFileString(
        file,
        JSON.stringify({
          technologies: { Example: { cats: [7], website: 'x' } },
          categories: {},
          groups: {},
        })
      )
      const error = yield* run('detect', '-f', file, 'example.com').pipe(
        Effect.flip
      )
      expect(error.message).toMatch(
        new RegExp(`^Could not load the fingerprints from ${file}\n`)
      )
      expect(error.message).toContain('Unknown category 7')
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('fails on fingerprints that are not JSON', () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const file = path.join(
        yield* fs.makeTempDirectoryScoped(),
        'fingerprints.json'
      )
      yield* fs.writeFileString(file, '{')
      const error = yield* run('detect', '-f', file, 'example.com').pipe(
        Effect.flip
      )
      expect(error.message).toBe(
        `Could not load the fingerprints from ${file}\n${file} is not valid JSON`
      )
    }).pipe(Effect.provide(TestLayer))
  )
})

describe('collect', () => {
  it.live('prints the observation as JSON', () =>
    Effect.gen(function* () {
      const url = yield* serve(acme)
      yield* run('collect', url, '-f', fingerprints)
      const [line] = yield* TestConsole.logLines
      expect(JSON.parse(String(line))).toMatchObject({
        url: [url],
        header: { 'x-powered-by': ['AcmeCMS/2.1'] },
        html: ['<html><script src="/beta.js"></script></html>'],
        scriptSrc: [`${url}beta.js`],
        domExists: [],
      })
    }).pipe(Effect.provide(TestLayer))
  )

  it.live('fails when the page cannot be loaded', () =>
    Effect.gen(function* () {
      const error = yield* run(
        'collect',
        '-f',
        fingerprints,
        '127.0.0.1:1'
      ).pipe(Effect.flip)
      expect(error.message).toBe(
        'Could not load https://127.0.0.1:1/: bad port'
      )
    }).pipe(Effect.provide(TestLayer))
  )
})
