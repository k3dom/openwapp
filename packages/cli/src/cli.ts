import { Collector, Page } from '@openwapp/collector'
import { Matcher, Requirements } from '@openwapp/matcher'
import { Array, Config, Console, Duration, Effect, Option } from 'effect'
import { Argument, CliError, Command, Flag } from 'effect/cli'

import * as Fingerprints from '#/fingerprints.ts'

const seconds = (name: string, fallback: number, description: string) =>
  Flag.Finite(name).pipe(
    Flag.withDescription(description),
    Flag.filter(
      (value) => value > 0,
      (value) => `Expected a positive number of seconds, got ${value}`
    ),
    Flag.withDefault(fallback)
  )

const url = Argument.String('url').pipe(
  Argument.withDescription('Url of the site, where https:// may be left out'),
  Argument.map((url) =>
    /^[a-z][\d+.a-z-]*:\/\//i.test(url) ? url : `https://${url}`
  )
)

const root = Command.make('openwapp').pipe(
  Command.withSharedFlags({
    fingerprints: Flag.Path('fingerprints', { mustExist: true }).pipe(
      Flag.withAlias('f'),
      Flag.withDescription(
        'Fingerprints in the webappanalyzer format, as a directory or a JSON file. Defaults to $OPENWAPP_FINGERPRINTS'
      ),
      Flag.withFallbackConfig(Config.String('OPENWAPP_FINGERPRINTS'))
    ),
    headers: Flag.String('header').pipe(
      Flag.withAlias('H'),
      Flag.withMetavar('"name: value"'),
      Flag.withDescription(
        'Header to send with every request. Repeat it to send several'
      ),
      Flag.filterMap(
        (header) => {
          const colon = header.indexOf(':')
          return colon > 0
            ? Option.some([
                header.slice(0, colon).trim(),
                header.slice(colon + 1).trim(),
              ] as const)
            : Option.none()
        },
        (header) => `Expected a header as "name: value", got "${header}"`
      ),
      Flag.atLeast(0)
    ),
    dnsServers: Flag.String('dns-server').pipe(
      Flag.withDescription(
        'DNS server to query. Repeat it to query several. Defaults to the system servers'
      ),
      Flag.atLeast(0)
    ),
    timeout: seconds(
      'timeout',
      30,
      'Seconds that loading a page may take. Defaults to 30'
    ),
    lookupTimeout: seconds(
      'lookup-timeout',
      10,
      'Seconds that each other lookup may take before it is skipped. Defaults to 10'
    ),
  }),
  Command.withDescription('Reports which technologies websites are built with')
)

const prepare = Effect.gen(function* () {
  const { fingerprints, headers, dnsServers, timeout, lookupTimeout } =
    yield* root
  const catalog = yield* Fingerprints.load(fingerprints)
  const requirements = Requirements.fromCatalog(catalog)
  const layer = Collector.layerOptions({
    headers: Object.fromEntries(headers),
    ...(dnsServers.length > 0 && { resolver: { servers: dnsServers } }),
  })
  return {
    catalog,
    collect: (url: string) =>
      Collector.collect(url, requirements, {
        lookupTimeout: Duration.seconds(lookupTimeout),
      }).pipe(
        Effect.timeoutOrElse({
          duration: Duration.seconds(timeout),
          orElse: () =>
            Effect.fail(
              new Page.PageError({
                url,
                cause: new Error(`timed out after ${timeout} seconds`),
              })
            ),
        }),
        Effect.mapError((error) => {
          let reason: Error = error
          while (reason.cause instanceof Error) reason = reason.cause
          return reason === error
            ? error.message
            : `${error.message}: ${reason.message}`
        }),
        Effect.provide(layer)
      ),
  }
})

const detect = Command.make(
  'detect',
  {
    urls: url.pipe(Argument.variadic({ min: 1 })),
    json: Flag.Boolean('json').pipe(
      Flag.withDescription('Print one JSON object per site instead of text'),
      Flag.withDefault(false)
    ),
    concurrency: Flag.Int('concurrency').pipe(
      Flag.withAlias('c'),
      Flag.withDescription('How many sites to scan at once. Defaults to 5'),
      Flag.filter(
        (value) => value > 0,
        (value) => `Expected a positive number, got ${value}`
      ),
      Flag.withDefault(5)
    ),
  },
  Effect.fn('detect')(function* ({ urls, json, concurrency }) {
    const { catalog, collect } = yield* prepare
    const failures = Array.getFailures(
      yield* Effect.forEach(
        urls,
        (url) =>
          collect(url).pipe(
            Effect.map((observation) => ({
              url,
              finalUrl: observation.url.at(-1) ?? url,
              technologies: Matcher.match(catalog, observation).map(
                ({ technology, confidence, version }) => ({
                  name: technology.name,
                  version,
                  confidence,
                  categories: technology.categories.flatMap(
                    (id) => catalog.categories.get(id)?.name ?? []
                  ),
                  website: technology.website,
                  description: technology.description,
                  cpe: technology.cpe,
                })
              ),
            })),
            Effect.tap((site) => {
              if (json) return Console.log(JSON.stringify(site))
              const rows = site.technologies.map(
                ({ name, version, confidence, categories }) =>
                  [
                    [name, version, confidence < 100 && `(${confidence}%)`]
                      .filter(Boolean)
                      .join(' '),
                    categories.join(', '),
                  ] as const
              )
              const width = Math.max(0, ...rows.map(([label]) => label.length))
              return Console.log(
                [
                  site.finalUrl,
                  ...(rows.length === 0
                    ? ['  No technologies detected']
                    : rows.map(
                        ([label, categories]) =>
                          `  ${label.padEnd(width)}  ${categories}`
                      )),
                ].join('\n')
              )
            }),
            Effect.tapError((error) =>
              json ? Console.log(JSON.stringify({ url, error })) : Effect.void
            ),
            Effect.result
          ),
        { concurrency }
      )
    )
    if (failures.length > 0) {
      return yield* new CliError.UserError({
        cause: failures,
        userMessage: failures.join('\n'),
      })
    }
  })
).pipe(
  Command.withDescription('Detect the technologies of one or more sites'),
  Command.withExamples([
    {
      command: 'openwapp detect example.com',
      description: 'List the technologies of a site',
    },
    {
      command: 'openwapp detect --json example.com example.org',
      description: 'Print one JSON object per site',
    },
  ])
)

const collect = Command.make(
  'collect',
  { url },
  Effect.fn('collect')(function* ({ url }) {
    const { collect } = yield* prepare
    const observation = yield* collect(url).pipe(
      Effect.mapError(
        (error) => new CliError.UserError({ cause: error, userMessage: error })
      )
    )
    yield* Console.log(
      JSON.stringify(
        observation,
        (_, value: unknown) =>
          value instanceof Map
            ? Object.fromEntries(value)
            : value instanceof Set
              ? [...value]
              : value,
        2
      )
    )
  })
).pipe(
  Command.withDescription(
    'Print what was observed on a site as JSON, without matching it'
  )
)

export const command = root.pipe(Command.withSubcommands([detect, collect]))
