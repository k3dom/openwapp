import {
  type Catalog,
  Matcher,
  Observation,
  Requirements,
} from '@openwapp/matcher'
import { Array, Cause, Effect, Exit, Layer, Option, Result } from 'effect'
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http'
import { NetAddress } from 'effect/net'

import * as Certificate from '#/certificate.ts'
import * as Markup from '#/markup.ts'
import * as Page from '#/page.ts'
import * as Resolver from '#/resolver.ts'

export interface PromiseOptions {
  readonly signal?: AbortSignal
}

export const layer = Layer.mergeAll(
  Page.layerHttp,
  Certificate.layerNode,
  Resolver.layerNode
).pipe(Layer.provideMerge(FetchHttpClient.layer))

export const collect = Effect.fn('Collector.collect')(
  function* (url: string | URL, requirements: Requirements.Requirements) {
    const target = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) => new Page.PageError({ url: String(url), cause }),
    })
    const page = yield* Page.Page
    const certificate = yield* Certificate.Certificate
    const resolver = yield* Resolver.Resolver
    const snapshot = yield* page.load(target, requirements)
    const site = URL.parse(snapshot.url.at(-1) ?? '') ?? target
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(site.origin)),
      HttpClient.followRedirects(),
      HttpClient.filterStatusOk
    )

    const optional = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.timeout('10 seconds'),
        Effect.tapError(Effect.logDebug),
        Effect.option
      )
    const fetchText = (path: string) =>
      optional(
        client.get(path).pipe(Effect.flatMap((response) => response.text))
      )

    const fields = yield* Effect.all(
      {
        robots: requirements.robots
          ? fetchText('/robots.txt').pipe(Effect.map(Option.toArray))
          : Effect.succeed([]),
        probe: Effect.forEach(
          requirements.probe,
          (path) =>
            fetchText(path).pipe(
              Effect.map(Option.map((body) => [path, Array.of(body)] as const))
            ),
          { concurrency: 'unbounded' }
        ).pipe(Effect.map((found) => new Map(Array.getSomes(found)))),
        dns: Result.match(
          NetAddress.ipFromString(site.hostname.replace(/^\[|\]$/g, '')),
          {
            onSuccess: () => Effect.succeed(new Map()),
            onFailure: () =>
              Effect.forEach(
                requirements.dns,
                (type) =>
                  optional(
                    resolver.resolve(
                      // Mail, verification and name server records usually
                      // sit on the apex domain, while address records belong
                      // to the exact host.
                      type === 'A' || type === 'AAAA' || type === 'CNAME'
                        ? site.hostname
                        : site.hostname.replace(/^www\./, ''),
                      type
                    )
                  ).pipe(
                    Effect.map((records) =>
                      records.pipe(
                        Option.filter(Array.isReadonlyArrayNonEmpty),
                        Option.map((records) => [type, records] as const)
                      )
                    )
                  ),
                { concurrency: 'unbounded' }
              ).pipe(Effect.map((found) => new Map(Array.getSomes(found)))),
          }
        ),
        certIssuer:
          requirements.certIssuer && site.protocol === 'https:'
            ? optional(certificate.issuer(site)).pipe(
                Effect.map(Option.toArray)
              )
            : Effect.succeed([]),
      },
      { concurrency: 'unbounded' }
    )
    return new Observation.Observation({
      ...snapshot,
      ...Markup.extract(snapshot.html.at(-1) ?? '', site, requirements),
      ...fields,
    })
  },
  Effect.provideService(HttpClient.TracerPropagationEnabled, false)
)

export const collectPromise = (
  url: string | URL,
  requirements: Requirements.Requirements,
  options?: PromiseOptions
) =>
  Effect.runPromiseExit(
    collect(url, requirements).pipe(Effect.provide(layer)),
    options
  ).then(
    Exit.match({
      onSuccess: (observation) => observation,
      onFailure: (cause) =>
        Promise.reject(
          options?.signal?.aborted && Cause.hasInterruptsOnly(cause)
            ? options.signal.reason
            : Cause.squash(cause)
        ),
    })
  )

export const detect = Effect.fn('Collector.detect')(function* (
  catalog: Catalog.Catalog,
  url: string | URL
) {
  const observation = yield* collect(url, Requirements.fromCatalog(catalog))
  return Matcher.match(catalog, observation)
})

export const detectPromise = (
  catalog: Catalog.Catalog,
  url: string | URL,
  options?: PromiseOptions
) =>
  collectPromise(url, Requirements.fromCatalog(catalog), options).then(
    (observation) => Matcher.match(catalog, observation)
  )
