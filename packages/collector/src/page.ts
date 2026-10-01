import type { Observation, Requirements } from '@openwapp/matcher'
import { Array, Context, Effect, Layer, pipe, Record, Schema } from 'effect'
import { HttpClient } from 'effect/unstable/http'

export type Snapshot = Pick<
  Observation.Observation,
  'url' | 'header' | 'cookie' | 'html'
>

export class PageError extends Schema.TaggedError<PageError>(
  '@openwapp/collector/page/PageError'
)('PageError', {
  url: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message() {
    return `Could not load ${this.url}`
  }
}

export class Page extends Context.Service<
  Page,
  {
    readonly load: (
      url: URL,
      requirements: Requirements.Requirements
    ) => Effect.Effect<Snapshot, PageError>
  }
>()('@openwapp/collector/page/Page') {}

export const layerHttp: Layer.Layer<Page, never, HttpClient.HttpClient> =
  Layer.effect(
    Page,
    Effect.gen(function* () {
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.followRedirects()
      )
      return Page.of({
        load: Effect.fn('Page.load')(
          function* (url) {
            const response = yield* client.get(url)
            return {
              url: [response.url],
              header: new Map(
                Object.entries(response.headers).map(
                  ([name, value]) => [name, Array.of(value)] as const
                )
              ),
              cookie: new Map(
                pipe(
                  Record.values(response.cookies.cookies),
                  Array.groupBy(({ name }) => name.toLowerCase()),
                  Record.map(Array.map(({ value }) => value)),
                  Record.toEntries
                )
              ),
              html: [yield* response.text],
            }
          },
          (effect, url) =>
            Effect.mapError(
              effect,
              (cause) => new PageError({ url: url.href, cause })
            )
        ),
      })
    })
  )
