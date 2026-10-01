# openwapp

Open source matching engine and collector for Wappalyzer fingerprints, built on
the community maintained
[enthec/webappanalyzer](https://github.com/enthec/webappanalyzer) data.

| package                                           | description                                         |
| ------------------------------------------------- | --------------------------------------------------- |
| [`@openwapp/fingerprints`](packages/fingerprints) | The enthec fingerprints, kept in sync with upstream |
| [`@openwapp/matcher`](packages/matcher)           | Matches the fingerprints against observed site data |
| [`@openwapp/collector`](packages/collector)       | Visits a site and reports what was detected         |

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
