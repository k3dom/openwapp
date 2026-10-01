import type { Observation, Requirements } from '@openwapp/matcher'
import { Array, Context, Effect, Layer, Schema } from 'effect'
import { Cookies, HttpClient } from 'effect/unstable/http'

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
      return {
        load: (url) =>
          client.get(url).pipe(
            Effect.flatMap((response) =>
              Effect.map(response.text, (html) => {
                const setCookie = Cookies.toSetCookieHeaders(response.cookies)
                return {
                  url: [response.url],
                  header: new Map([
                    ...Object.entries(response.headers).map(
                      ([name, value]) => [name, Array.of(value)] as const
                    ),
                    ...(Array.isArrayNonEmpty(setCookie)
                      ? [['set-cookie', setCookie] as const]
                      : []),
                  ]),
                  cookie: new Map(
                    Object.entries(
                      Array.groupBy(
                        Object.values(response.cookies.cookies),
                        ({ name }) => name.toLowerCase()
                      )
                    ).map(
                      ([name, cookies]) =>
                        [
                          name,
                          Array.map(cookies, ({ value }) => value),
                        ] as const
                    )
                  ),
                  html: [html],
                }
              })
            ),
            Effect.mapError((cause) => new PageError({ url: url.href, cause }))
          ),
      }
    })
  )
