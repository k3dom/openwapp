# Plan

openwapp finds out which technologies a website is built with, such as its CMS,
shop system or hosting.

Wappalyzer used to do this in the open but went closed source in 2023. Its
fingerprints live on in the community maintained
[enthec/webappanalyzer](https://github.com/enthec/webappanalyzer), but there is
no well maintained engine in the TypeScript ecosystem that runs them. openwapp
is that engine, built with Effect.

It consists of three parts:

- **fingerprints**: the enthec data, kept in sync with upstream. Its format is
  defined by the
  [webappanalyzer specification](https://github.com/enthec/webappanalyzer#specification).
- **matcher**: turns the fingerprints into a typed catalog and matches it
  against what was observed on a site. The
  [HTTP Archive fork of Wappalyzer](https://github.com/HTTPArchive/wappalyzer/blob/main/src/js/wappalyzer.js#L104)
  serves only as a reference for how detections are resolved. Its code must not
  be copied.
- **collector**: visits a site, gathers what the matcher needs and reports what
  was detected

## Matcher

| Function                                               | Purpose                                                                     |
| ------------------------------------------------------ | --------------------------------------------------------------------------- |
| `Catalog.decode(input): Effect<Catalog, CatalogError>` | Decode and validate the raw technologies, categories and groups             |
| `new Observation.Observation(fields): Observation`     | Hold what the collector observed on a site, with one field per rule tag     |
| `Requirements.fromCatalog(catalog): Requirements`      | List what the collector must gather, such as JS globals and DOM selectors   |
| `Matcher.match(catalog, observation): Detection[]`     | Match the patterns, then resolve requires, excludes, implies and confidence |

The `Observation` links the three steps. `Requirements` tells the collector
which of its fields to fill, the collector fills them and `Matcher` tests each
rule against the field named after its tag.
