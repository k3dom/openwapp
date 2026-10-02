# matcher

Turns the fingerprints into a typed catalog and matches it against what was
observed on a site.

## Install

```sh
pnpm add @openwapp/matcher effect
```

`effect` is a peer dependency, so install it even when you do not use Effect
yourself. Every function that returns an Effect has a plain counterpart.

## Usage

### Catalog

`Catalog.decode` turns fingerprints in the
[webappanalyzer format](https://github.com/enthec/webappanalyzer#specification)
into a `Catalog`. It fails with a `CatalogError` listing every invalid
fingerprint and unknown reference. Load the fingerprints from
`@openwapp/fingerprints` or bring your own object of `technologies`,
`categories` and `groups`.

```ts
import fingerprints from '@openwapp/fingerprints'
```

**Without Effect**, `Catalog.decodeSync` throws the `CatalogError`.

```ts
import { Catalog } from '@openwapp/matcher'

try {
  const catalog = Catalog.decodeSync(fingerprints)
  console.log(catalog.technologies.size)
} catch (error) {
  if (error instanceof Catalog.CatalogError) console.error(error.message)
  else throw error
}
```

**With Effect**:

```ts
import { Catalog } from '@openwapp/matcher'
import { Console, Effect } from 'effect'

const program = Catalog.decode(fingerprints).pipe(
  Effect.flatMap((catalog) => Console.log(catalog.technologies.size)),
  Effect.catchTag('CatalogError', (error) => Console.error(error.message))
)

await Effect.runPromise(program)
```

### Observation

An `Observation` holds what was observed on a site, with one field per rule tag.
Fields default to empty. Header, cookie and meta names must be lowercase. Store
cookies under their real names, such as `_ga_l7xq2bxp4n`. A `*` in the cookie
name of a rule, as in `_ga_*`, stands for any run of characters.

```ts
import { Observation } from '@openwapp/matcher'

const observation = new Observation.Observation({
  url: ['https://example.com/'],
  header: new Map([['x-powered-by', ['PHP/8.3.0']]]),
  scriptSrc: ['https://example.com/jquery-3.7.1.min.js'],
  dns: new Map([['TXT', ['v=spf1 include:_spf.google.com ~all']]]),
  domExists: new Set(['#wpadminbar']),
  domAttribute: new Map([['link', new Map([['href', ['/wp-content/a.css']]]])]),
})
```

### Requirements

`Requirements.fromCatalog` lists what must be gathered to fill an observation
for a catalog.

```ts
import { Requirements } from '@openwapp/matcher'

const requirements = Requirements.fromCatalog(catalog)
console.log(requirements.robots, [...requirements.js])
```

To skip a source, empty its field in a copy:

```ts
const withoutDns = new Requirements.Requirements({
  ...requirements,
  dns: new Set(),
  certIssuer: false,
})
```

### Matcher

`Matcher.match` returns a `Detection` for every technology found in the
observation.

```ts
import { Matcher } from '@openwapp/matcher'

for (const { technology, confidence, version } of Matcher.match(
  catalog,
  observation
)) {
  console.log(technology.name, version, confidence)
}
```

## License

MIT. The matcher ships without fingerprint data. Install
`@openwapp/fingerprints` (GPL-3.0-only) or bring your own.
