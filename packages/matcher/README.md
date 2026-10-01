# matcher

Turns the fingerprints into a typed catalog and matches it against what was
observed on a site.

## Usage

`Catalog.decodeSync` and `Catalog.decode` take the raw technologies, categories
and groups in the
[webappanalyzer format](https://github.com/enthec/webappanalyzer#specification)
and produce a validated `Catalog`. When the input does not match the format,
they fail with a `CatalogError` that lists every invalid fingerprint. Once the
input matches, they check that every reference points to a known technology,
category or group and list all that do not.

Load the fingerprints from `@openwapp/fingerprints` or bring your own.

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

Then decode them into a catalog.

**Without Effect**, `Catalog.decodeSync` returns the catalog and throws the
`CatalogError`.

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

**With Effect**, `Catalog.decode` returns an `Effect` that fails with the
`CatalogError`.

```ts
import { Catalog } from '@openwapp/matcher'
import { Console, Effect } from 'effect'

const program = Catalog.decode(input).pipe(
  Effect.flatMap((catalog) => Console.log(catalog.technologies.size)),
  Effect.catchTag('CatalogError', (error) => Console.error(error.message))
)

await Effect.runPromise(program)
```

## License

MIT. The matcher ships without fingerprint data. Install
`@openwapp/fingerprints` (GPL-3.0-only) or bring your own.
