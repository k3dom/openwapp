# icons

The [enthec/webappanalyzer](https://github.com/enthec/webappanalyzer) technology
icons, kept in sync with upstream.

## Contents

The upstream files are shipped unmodified under `data/`.

| file             | upstream                   |
| ---------------- | -------------------------- |
| `*.svg`, `*.png` | `src/images/icons/*`       |
| `upstream.json`  | the upstream commit synced |

## Usage

Each technology names its icon in `icon`, which resolves under that file name.

```ts
import { readFile } from 'node:fs/promises'

const file = await readFile(
  new URL(import.meta.resolve(`@openwapp/icons/${technology.icon}`))
)
```

## Syncing

`pnpm sync` replaces `data/` with the icons of the upstream commit that
`@openwapp/fingerprints` is synced to. The weekly fingerprints workflow runs it
as well.

## License

GPL-3.0-only, the license of the upstream data.
