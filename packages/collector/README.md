# collector

Visits a site, gathers what the matcher needs and reports what was detected.

## Usage

### Detect

`Collector.detect` loads a page, collects what the catalog's rules test and
matches it. Build the catalog with `Catalog.decode` from `@openwapp/matcher`. It
fails with a `PageError` when the page cannot be loaded. Other requests, such as
robots.txt, are skipped when they fail.

**Without Effect**, `Collector.detectPromise` rejects with the `PageError`. Pass
a `signal` to stop it.

```ts
import { Collector, Page } from '@openwapp/collector'

try {
  const detections = await Collector.detectPromise(
    catalog,
    'https://example.com',
    { signal: AbortSignal.timeout(10_000) }
  )
  for (const { technology, version } of detections) {
    console.log(technology.name, version)
  }
} catch (error) {
  if (error instanceof Page.PageError) console.error(error.message)
  else throw error
}
```

**With Effect**, provide `Collector.layer`, which loads pages with `fetch`.

```ts
import { Collector } from '@openwapp/collector'
import { Console, Effect } from 'effect'

const program = Collector.detect(catalog, 'https://example.com').pipe(
  Effect.flatMap((detections) => Console.log(detections.length)),
  Effect.catchTag('PageError', (error) => Console.error(error.message)),
  Effect.provide(Collector.layer)
)

await Effect.runPromise(program)
```

### Collect

`Collector.collect` returns the `Observation` without matching it. It gathers
what the `Requirements` list.

```ts
import { Collector } from '@openwapp/collector'
import { Requirements } from '@openwapp/matcher'

const observation = await Collector.collectPromise(
  'https://example.com',
  Requirements.fromCatalog(catalog)
)
```

```ts
const observation = await Effect.runPromise(
  Collector.collect(
    'https://example.com',
    Requirements.fromCatalog(catalog)
  ).pipe(Effect.provide(Collector.layer))
)
```

### Page

The `Page` service loads the page itself. `Page.layerHttp` fetches it with the
`HttpClient` in context and fills `url`, `header`, `cookie` and `html`. Provide
another `HttpClient` to change how requests are sent, or another `Page` to load
pages differently.

```ts
import { Collector, Page } from '@openwapp/collector'
import { Effect, Layer } from 'effect'
import { FetchHttpClient } from 'effect/unstable/http'

const layer = Page.layerHttp.pipe(Layer.provideMerge(FetchHttpClient.layer))

const program = Collector.detect(catalog, 'https://example.com').pipe(
  Effect.provide(layer)
)
```

## License

MIT. The collector ships without fingerprint data. Install
`@openwapp/fingerprints` (GPL-3.0-only) or bring your own.
