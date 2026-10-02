# @openwapp/collector

## 0.1.0

### Minor Changes

- a561f1a: Extract the page text, inline style sheets and scripts, script urls,
  meta tags and the DOM selectors, texts and attributes the catalog asks for
  from the HTML of the page. External scripts and style sheets are not fetched,
  and JS globals, XHR requests and DOM properties still need a real browser.

### Patch Changes

- Updated dependencies [7cf140b]
  - @openwapp/matcher@0.1.0
