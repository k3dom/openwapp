import {
  type Catalog,
  Matcher,
  Observation,
  Requirements,
} from '@openwapp/matcher'
import { Array, Effect, Layer, Option } from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from 'effect/unstable/http'

import * as Page from '#/page.ts'

export interface PromiseOptions {
  readonly signal?: AbortSignal
}

export const layer: Layer.Layer<Page.Page | HttpClient.HttpClient> =
  Page.layerHttp.pipe(Layer.provideMerge(FetchHttpClient.layer))

export const collect = (
  url: string | URL,
  requirements: Requirements.Requirements
): Effect.Effect<
  Observation.Observation,
  Page.PageError,
  Page.Page | HttpClient.HttpClient
> =>
  Effect.gen(function* () {
    const target = yield* Effect.try({
      try: () => new URL(url),
      catch: (cause) => new Page.PageError({ url: String(url), cause }),
    })
    const page = yield* Page.Page
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.followRedirects()
    )
    const fetchText = (path: string) =>
      client.get(new URL(path, target)).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((response) => response.text),
        Effect.tapError((error) => Effect.logDebug(error)),
        Effect.option
      )

    const { snapshot, robots, probe } = yield* Effect.all(
      {
        snapshot: page.load(target, requirements),
        robots: requirements.robots
          ? fetchText('/robots.txt')
          : Effect.succeedNone,
        probe: Effect.forEach(
          requirements.probe,
          (path) =>
            fetchText(path).pipe(
              Effect.map(Option.map((body) => [path, Array.of(body)] as const))
            ),
          { concurrency: 'unbounded' }
        ),
      },
      { concurrency: 'unbounded' }
    )
    return new Observation.Observation({
      ...snapshot,
      robots: Option.toArray(robots),
      probe: new Map(Array.getSomes(probe)),
    })
  }).pipe(Effect.provideService(HttpClient.TracerPropagationEnabled, false))

export const collectPromise = (
  url: string | URL,
  requirements: Requirements.Requirements,
  options?: PromiseOptions
): Promise<Observation.Observation> =>
  Effect.runPromise(
    collect(url, requirements).pipe(Effect.provide(layer)),
    options
  )

export const detect = (
  catalog: Catalog.Catalog,
  url: string | URL
): Effect.Effect<
  ReadonlyArray<Matcher.Detection>,
  Page.PageError,
  Page.Page | HttpClient.HttpClient
> =>
  collect(url, Requirements.fromCatalog(catalog)).pipe(
    Effect.map((observation) => Matcher.match(catalog, observation))
  )

export const detectPromise = (
  catalog: Catalog.Catalog,
  url: string | URL,
  options?: PromiseOptions
): Promise<ReadonlyArray<Matcher.Detection>> =>
  Effect.runPromise(detect(catalog, url).pipe(Effect.provide(layer)), options)
