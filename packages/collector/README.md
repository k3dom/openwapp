# collector

Visits a site, gathers what the matcher needs and reports what was detected.

## Usage

### Detect

`Collector.detect` visits a site and returns what the catalog detects on it.
Build the catalog with `Catalog.decode` from `@openwapp/matcher`. It fails with
a `PageError` when the site cannot be loaded.

**Without Effect**, `Collector.detectPromise` rejects with the `PageError`. Pass
a `signal` to stop it early.

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

**With Effect**, provide `Collector.layer`:

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

`Collector.collect` returns the `Observation` without matching it.

**Without Effect**:

```ts
import { Collector } from '@openwapp/collector'
import { Requirements } from '@openwapp/matcher'

const requirements = Requirements.fromCatalog(catalog)
const observation = await Collector.collectPromise(
  'https://example.com',
  requirements
)
```

**With Effect**:

```ts
const observation = await Effect.runPromise(
  Collector.collect('https://example.com', requirements).pipe(
    Effect.provide(Collector.layer)
  )
)
```

## License

MIT. The collector ships without fingerprint data. Install
`@openwapp/fingerprints` (GPL-3.0-only) or bring your own.
