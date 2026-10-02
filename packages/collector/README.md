# collector

Visits a site, gathers what the matcher needs and reports what was detected.

## Install

```sh
pnpm add @openwapp/collector @openwapp/matcher effect
```

The collector runs on Node.js. `effect` is a peer dependency, so install it even
when you do not use Effect yourself.

## Usage

### Detect

`Collector.detect` visits a site and returns what the catalog detects on it.
Build the catalog with `Catalog.decode` from `@openwapp/matcher`. It fails with
a `PageError` when the site cannot be loaded.

**Without Effect**, `Collector.detectPromise` rejects with the `PageError`. Pass
a `signal` to stop it early. Nothing else limits how long loading the page
takes.

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

### Options

| option          | default                                     |
| --------------- | ------------------------------------------- |
| `headers`       | Chrome on Windows, merged with yours        |
| `fetch`         | `globalThis.fetch`                          |
| `resolver`      | the DNS servers Node.js uses                |
| `lookupTimeout` | 10 seconds for each lookup besides the page |

`headers`, `fetch` and `resolver` set how the collector reaches a site.
`resolver` takes the `servers` to query along with the `timeout`, `tries` and
`maxTimeout` of a `node:dns` resolver. `lookupTimeout` limits how long
`/robots.txt`, each probe, each DNS lookup and the certificate may take. A
lookup that takes longer is left out of the observation.

**Without Effect**, pass them next to the `signal`:

```ts
const detections = await Collector.detectPromise(
  catalog,
  'https://example.com',
  {
    signal: AbortSignal.timeout(30_000),
    headers: { 'user-agent': 'my-scanner/1.0' },
    resolver: { servers: ['1.1.1.1'] },
    lookupTimeout: '2 seconds',
  }
)
```

**With Effect**, `Collector.layerOptions` takes the first three and `collect`
and `detect` take `lookupTimeout`:

```ts
const program = Collector.detect(catalog, 'https://example.com', {
  lookupTimeout: '2 seconds',
}).pipe(
  Effect.provide(
    Collector.layerOptions({
      headers: { 'user-agent': 'my-scanner/1.0' },
      resolver: { servers: ['1.1.1.1'] },
    })
  )
)
```

To leave out sources such as DNS records or the certificate, collect with
requirements that do not ask for them. See the `Requirements` section of the
matcher.

### Services

`Collector.layer` is built from three services, which Effect users can replace
one by one:

- `Page.Page` loads the page. `Page.layerHttp` fetches it over HTTP.
- `Resolver.Resolver` resolves DNS records. `Resolver.layerNode` and
  `Resolver.layerNodeOptions` use `node:dns`.
- `Certificate.Certificate` reads the certificate issuer.
  `Certificate.layerNode` uses `node:tls`.

## License

MIT. The collector ships without fingerprint data. Install
`@openwapp/fingerprints` (GPL-3.0-only) or bring your own.
