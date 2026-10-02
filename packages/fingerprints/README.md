# fingerprints

The [enthec/webappanalyzer](https://github.com/enthec/webappanalyzer)
fingerprints, kept in sync with upstream.

## Contents

The upstream files are shipped unmodified under `data/`.

| file                        | upstream                        |
| --------------------------- | ------------------------------- |
| `technologies/{_,a-z}.json` | `src/technologies/{_,a-z}.json` |
| `categories.json`           | `src/categories.json`           |
| `groups.json`               | `src/groups.json`               |
| `schema.json`               | `schema.json`                   |
| `upstream.json`             | the upstream commit synced      |

Icons are not included.

## Usage

The default export holds every fingerprint in one object of `technologies`,
`categories` and `groups`, ready for `Catalog.decode` from `@openwapp/matcher`.

```ts
import fingerprints from '@openwapp/fingerprints'
import { Catalog } from '@openwapp/matcher'

const catalog = Catalog.decodeSync(fingerprints)
```

Each file under `data/` can be imported on its own as well.

```ts
import categories from '@openwapp/fingerprints/categories.json' with { type: 'json' }
```

## Syncing

`pnpm sync` replaces `data/` with the latest upstream commit on `main`, and
`pnpm sync <ref>` pins any branch, tag or commit. A weekly workflow runs the
sync and opens a pull request with a changeset when upstream changed.

## License

GPL-3.0-only, the license of the upstream data. enthec/webappanalyzer continues
the fingerprints of [Wappalyzer](https://github.com/wappalyzer/wappalyzer),
which went closed source in August 2023.
