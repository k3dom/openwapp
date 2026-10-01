import {
  type Catalog,
  Matcher,
  Observation,
  Requirements,
} from '@openwapp/matcher'
import { Array, Effect, Layer } from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from 'effect/unstable/http'

import * as Page from '#/page.ts'

export interface PromiseOptions {
  readonly signal?: AbortSignal
}

export const layer: Layer.Layer<Page.Page | HttpClient.HttpClient> =
  Page.layerHttp.pipe(Layer.provideMerge(FetchHttpClient.layer))

export const collect = Effect.fn('Collector.collect')(
  function* (
    url: string | URL,
    requirements: Requirements.Requirements
  ): Effect.fn.Return<
    Observation.Observation,
    Page.PageError,
    Page.Page | HttpClient.HttpClient
  > {
    const target = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) => new Page.PageError({ url: String(url), cause }),
    })
    const page = yield* Page.Page
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(target.origin)),
      HttpClient.followRedirects(),
      HttpClient.filterStatusOk
    )

    const fetchText = (path: string) =>
      client.get(path).pipe(
        Effect.flatMap((response) => response.text),
        Effect.tapError(Effect.logDebug)
      )

    const { snapshot, ...fields } = yield* Effect.all(
      {
        snapshot: page.load(target, requirements),
        robots: requirements.robots
          ? fetchText('/robots.txt').pipe(
              Effect.map(Array.of),
              Effect.orElseSucceed(() => [])
            )
          : Effect.succeed([]),
        probe: Effect.partition(
          requirements.probe,
          (path) =>
            fetchText(path).pipe(
              Effect.map((body) => [path, Array.of(body)] as const)
            ),
          { concurrency: 'unbounded' }
        ).pipe(Effect.map(([, found]) => new Map(found))),
      },
      { concurrency: 'unbounded' }
    )
    return new Observation.Observation({ ...snapshot, ...fields })
  },
  Effect.provideService(HttpClient.TracerPropagationEnabled, false)
)

export const collectPromise = (
  url: string | URL,
  requirements: Requirements.Requirements,
  options?: PromiseOptions
): Promise<Observation.Observation> =>
  Effect.runPromise(
    collect(url, requirements).pipe(Effect.provide(layer)),
    options
  ).catch((error: unknown) =>
    Promise.reject(options?.signal?.aborted ? options.signal.reason : error)
  )

export const detect = Effect.fn('Collector.detect')(function* (
  catalog: Catalog.Catalog,
  url: string | URL
): Effect.fn.Return<
  ReadonlyArray<Matcher.Detection>,
  Page.PageError,
  Page.Page | HttpClient.HttpClient
> {
  const observation = yield* collect(url, Requirements.fromCatalog(catalog))
  return Matcher.match(catalog, observation)
})

export const detectPromise = (
  catalog: Catalog.Catalog,
  url: string | URL,
  options?: PromiseOptions
): Promise<ReadonlyArray<Matcher.Detection>> =>
  collectPromise(url, Requirements.fromCatalog(catalog), options).then(
    (observation) => Matcher.match(catalog, observation)
  )
