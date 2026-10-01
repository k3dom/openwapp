# matcher

Turns the fingerprints into a typed catalog and matches it against what was
observed on a site.

## Usage

### Catalog

`Catalog.decode` turns fingerprints in the
[webappanalyzer format](https://github.com/enthec/webappanalyzer#specification)
into a `Catalog`. It fails with a `CatalogError` listing every invalid
fingerprint and unknown reference. Load the fingerprints from
`@openwapp/fingerprints` or bring your own.

```ts
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const resolve = createRequire(import.meta.url).resolve
const read = async (path: string) =>
  JSON.parse(await readFile(resolve(`@openwapp/fingerprints/${path}`), 'utf8'))

const directory = dirname(resolve('@openwapp/fingerprints/technologies/a.json'))
const input = {
  technologies: Object.assign(
    {},
    ...(await Promise.all(
      (await readdir(directory)).map((file) => read(join('technologies', file)))
    ))
  ),
  categories: await read('categories.json'),
  groups: await read('groups.json'),
}
```

**Without Effect**, `Catalog.decodeSync` throws the `CatalogError`.

```ts
import { Catalog } from '@openwapp/matcher'

try {
  const catalog = Catalog.decodeSync(input)
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

const program = Catalog.decode(input).pipe(
  Effect.flatMap((catalog) => Console.log(catalog.technologies.size)),
  Effect.catchTag('CatalogError', (error) => Console.error(error.message))
)

await Effect.runPromise(program)
```

### Observation

An `Observation` holds what was observed on a site, with one field per rule tag.
Fields default to empty. Header, cookie and meta names must be lowercase.

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
