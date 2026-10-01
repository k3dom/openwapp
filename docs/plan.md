# Plan

openwapp finds out which technologies a website is built with, such as its CMS,
shop system or hosting.

Wappalyzer used to do this in the open but went closed source in 2023. Its
fingerprints live on in the community maintained
[enthec/webappanalyzer](https://github.com/enthec/webappanalyzer), but there is
no well maintained engine in the TypeScript ecosystem that runs them. openwapp
is that engine, built with Effect.

It consists of three parts:

- **fingerprints**: the enthec data, kept in sync with upstream
- **matcher**: turns the fingerprints into a typed catalog and matches it
  against what was observed on a site
- **collector**: visits a site, gathers what the matcher needs and reports what
  was detected
