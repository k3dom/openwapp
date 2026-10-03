# openwapp

Open source matching engine and collector for Wappalyzer fingerprints, built on
the community maintained
[enthec/webappanalyzer](https://github.com/enthec/webappanalyzer) data.

| package                                           | description                                         | license      |
| ------------------------------------------------- | --------------------------------------------------- | ------------ |
| [`@openwapp/fingerprints`](packages/fingerprints) | The enthec fingerprints, kept in sync with upstream | GPL-3.0-only |
| [`@openwapp/icons`](packages/icons)               | The enthec icons named by the fingerprints          | GPL-3.0-only |
| [`@openwapp/matcher`](packages/matcher)           | Matches the fingerprints against observed site data | MIT          |
| [`@openwapp/collector`](packages/collector)       | Visits a site and reports what was detected         | MIT          |
| [`@openwapp/cli`](packages/cli)                   | Reports what a site is built with from the terminal | MIT          |

## Prerequisites

- Node.js 26
- pnpm 12

A Nix flake provides both. With direnv, run `direnv allow` once.

## Install & Run

```bash
pnpm install
turbo run build
turbo run lint test format:check
```

## License

Everything in this repository is [MIT](LICENSE) licensed, except
`packages/fingerprints` and `packages/icons`, which carry the upstream
fingerprint data and icons and are
[GPL-3.0-only](packages/fingerprints/LICENSE).
