import {
  type Catalog,
  Matcher,
  Observation,
  Requirements,
} from '@openwapp/matcher'
import {
  Array,
  Cause,
  type Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  Result,
} from 'effect'
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  type HttpClientResponse,
} from 'effect/http'
import { NetAddress } from 'effect/net'
import { getDomain } from 'tldts'

import * as Body from '#/body.ts'
import * as Certificate from '#/certificate.ts'
import * as Markup from '#/markup.ts'
import * as Page from '#/page.ts'
import * as Resolver from '#/resolver.ts'

/**
 * Options of `layerOptions`, which set how the collector reaches a site.
 */
export interface LayerOptions {
  /**
   * Headers sent with every request, merged over the defaults. These make the
   * collector look like Chrome on Windows, with a `user-agent`, `accept` and
   * `accept-language` header.
   */
  readonly headers?: Readonly<Record<string, string>>
  /**
   * The `fetch` that sends the requests, such as one going through a proxy.
   * Defaults to `globalThis.fetch`.
   */
  readonly fetch?: typeof globalThis.fetch
  /**
   * Options of the DNS resolver, such as the servers to query.
   */
  readonly resolver?: Resolver.NodeOptions
}

/**
 * Options of a single `collect` or `detect` call.
 */
export interface CollectOptions {
  /**
   * How long each lookup besides the page may take, which covers
   * `/robots.txt`, probes, DNS records and the certificate. A lookup that takes
   * longer is left out of the observation. Defaults to 10 seconds.
   */
  readonly lookupTimeout?: Duration.Input
}

/**
 * Options of `collectPromise` and `detectPromise`.
 */
export interface PromiseOptions extends LayerOptions, CollectOptions {
  /**
   * Stops the collector when aborted, which rejects with the abort reason.
   * Nothing else limits how long loading the page takes, so pass one such as
   * `AbortSignal.timeout(30_000)`.
   */
  readonly signal?: AbortSignal
}

/**
 * Provides what `collect` and `detect` need to visit sites over HTTP, TLS and
 * DNS, configured by the given options.
 *
 * @example
 * ```ts
 * import { Collector } from '@openwapp/collector'
 *
 * const layer = Collector.layerOptions({
 *   headers: { 'user-agent': 'my-scanner/1.0' },
 *   resolver: { servers: ['1.1.1.1'] },
 * })
 * ```
 */
export const layerOptions = ({ headers, fetch, resolver }: LayerOptions = {}) =>
  Layer.mergeAll(
    Page.layerHttp,
    Certificate.layerNode,
    Resolver.layerNodeOptions(resolver)
  ).pipe(
    Layer.provideMerge(
      FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(FetchHttpClient.RequestInit, {
              headers: {
                'user-agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
                accept:
                  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'en-US,en;q=0.9',
                ...Object.fromEntries(
                  Object.entries(headers ?? {}).map(([name, value]) => [
                    name.toLowerCase(),
                    value,
                  ])
                ),
              },
            }),
            fetch === undefined
              ? Layer.empty
              : Layer.succeed(FetchHttpClient.Fetch, fetch)
          )
        )
      )
    )
  )

/**
 * Provides what `collect` and `detect` need to visit sites over HTTP, TLS and
 * DNS, with the default options of `layerOptions`.
 */
export const layer = layerOptions()

/**
 * Visits a site and gathers what the requirements ask for into an
 * `Observation`.
 *
 * Loads the page, following redirects, and reads the parts of its html the
 * requirements ask for. As far as they ask for it, it then fetches
 * `/robots.txt` and the probed paths from the final site, resolves its DNS
 * records and reads its certificate. Lookups that fail or time out are left
 * out of the observation.
 *
 * Reads at most the first 2 MiB of the page and of each probe and the first
 * 500 KiB of `/robots.txt`. Only that part of a larger body is observed.
 *
 * Fails with a `PageError` when the page cannot be loaded. Provide `layer` or
 * `layerOptions` to run it. Use `collectPromise` to run it without Effect.
 */
export const collect = Effect.fn('Collector.collect')(
  function* (
    url: string | URL,
    requirements: Requirements.Requirements,
    { lookupTimeout = '10 seconds' }: CollectOptions = {}
  ) {
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
      HttpClient.followRedirects()
    )
    const servesPath =
      (path: string) => (response: HttpClientResponse.HttpClientResponse) =>
        response.status >= 200 &&
        response.status < 300 &&
        HttpClientRequest.get(path).pipe(
          HttpClientRequest.prependUrl(site.origin),
          HttpClientRequest.toUrl,
          Option.exists((url) => url.href === response.url)
        )
    const unknownPath = `/${crypto.randomUUID()}`

    const optional = <A, E>(effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.timeout(lookupTimeout),
        Effect.tapError(Effect.logDebug),
        Effect.option
      )
    const fetchText = (path: string, limit?: number) =>
      optional(
        HttpClient.filterStatusOk(client)
          .get(path)
          .pipe(Effect.flatMap((response) => Body.text(response, limit)))
      )

    const fields = yield* Effect.all(
      {
        robots: requirements.robots
          ? fetchText('/robots.txt', 500 * 1024).pipe(
              Effect.map(Option.toArray)
            )
          : Effect.succeed([]),
        probe:
          requirements.probe.size === 0
            ? Effect.succeed(new Map())
            : Effect.all(
                {
                  unknown: optional(client.get(unknownPath)),
                  found: Effect.forEach(
                    requirements.probe,
                    (path) =>
                      optional(
                        client.get(path).pipe(
                          Effect.filterOrFail(servesPath(path)),
                          Effect.flatMap((response) => Body.text(response)),
                          Effect.map((body) => [path, Array.of(body)] as const)
                        )
                      ),
                    { concurrency: 'unbounded' }
                  ),
                },
                { concurrency: 'unbounded' }
              ).pipe(
                Effect.map(
                  ({ unknown, found }) =>
                    new Map(
                      Option.exists(
                        unknown,
                        Predicate.not(servesPath(unknownPath))
                      )
                        ? Array.getSomes(found)
                        : []
                    )
                )
              ),
        dns: Result.match(
          NetAddress.ipFromString(site.hostname.replace(/^\[|\]$/g, '')),
          {
            onSuccess: () => Effect.succeed(new Map()),
            onFailure: () => {
              const domain =
                getDomain(site.hostname, { allowPrivateDomains: true }) ??
                site.hostname
              return Effect.forEach(
                requirements.dns,
                (type) =>
                  optional(
                    resolver.resolve(
                      // Mail, verification and name server records usually
                      // sit on the apex domain, while address records belong
                      // to the exact host.
                      type === 'A' || type === 'AAAA' || type === 'CNAME'
                        ? site.hostname
                        : domain,
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
              ).pipe(Effect.map((found) => new Map(Array.getSomes(found))))
            },
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

/**
 * Visits a site and gathers what the requirements ask for into an
 * `Observation`, like `collect` but without Effect.
 *
 * Rejects with a `PageError` when the page cannot be loaded, or with the
 * reason of an aborted `signal`.
 *
 * @example
 * ```ts
 * import { Collector } from '@openwapp/collector'
 * import { Requirements } from '@openwapp/matcher'
 *
 * const observation = await Collector.collectPromise(
 *   'https://example.com',
 *   Requirements.fromCatalog(catalog),
 *   { signal: AbortSignal.timeout(30_000) }
 * )
 * ```
 */
export const collectPromise = (
  url: string | URL,
  requirements: Requirements.Requirements,
  options: PromiseOptions = {}
) =>
  Effect.runPromiseExit(
    collect(url, requirements, options).pipe(
      Effect.provide(layerOptions(options))
    ),
    { signal: options.signal }
  ).then(
    Exit.match({
      onSuccess: (observation) => observation,
      onFailure: (cause) =>
        Promise.reject(
          options.signal?.aborted && Cause.hasInterruptsOnly(cause)
            ? options.signal.reason
            : Cause.squash(cause)
        ),
    })
  )

/**
 * Visits a site and returns what the catalog detects on it. Gathers only what
 * the catalog can make use of.
 *
 * Fails with a `PageError` when the page cannot be loaded. Provide `layer` or
 * `layerOptions` to run it. Use `detectPromise` to run it without Effect.
 */
export const detect = Effect.fn('Collector.detect')(function* (
  catalog: Catalog.Catalog,
  url: string | URL,
  options?: CollectOptions
) {
  const observation = yield* collect(
    url,
    Requirements.fromCatalog(catalog),
    options
  )
  return Matcher.match(catalog, observation)
})

/**
 * Visits a site and returns what the catalog detects on it, like `detect` but
 * without Effect.
 *
 * Rejects with a `PageError` when the page cannot be loaded, or with the
 * reason of an aborted `signal`.
 *
 * @example
 * ```ts
 * import { Collector } from '@openwapp/collector'
 *
 * const detections = await Collector.detectPromise(
 *   catalog,
 *   'https://example.com',
 *   { signal: AbortSignal.timeout(30_000) }
 * )
 * ```
 */
export const detectPromise = (
  catalog: Catalog.Catalog,
  url: string | URL,
  options?: PromiseOptions
) =>
  collectPromise(url, Requirements.fromCatalog(catalog), options).then(
    (observation) => Matcher.match(catalog, observation)
  )
