import { describe, expect, it } from '@effect/vitest'
import { Catalog, Requirements } from '@openwapp/matcher'

import * as Markup from '#/markup.ts'

const requirementsOf = (technologies: Record<string, object>) =>
  Requirements.fromCatalog(
    Catalog.decodeSync({
      technologies: Object.fromEntries(
        Object.entries(technologies).map(([name, technology]) => [
          name,
          { cats: [1], website: 'https://example.com', ...technology },
        ])
      ),
      categories: { 1: { name: 'CMS', priority: 1, groups: [1] } },
      groups: { 1: { name: 'Content' } },
    })
  )

describe('Markup.extract', () => {
  it('extracts nothing the catalog does not ask for', () => {
    const markup = Markup.extract(
      `<html><head>
        <meta name="generator" content="Example">
        <style>.example {}</style>
        <script src="/example.js"></script>
        <script>example()</script>
      </head><body><div id="example">Example</div></body></html>`,
      'https://example.com/',
      requirementsOf({})
    )
    expect(markup).toEqual({
      text: [],
      css: [],
      script: [],
      scriptSrc: [],
      meta: new Map(),
      domExists: new Set(),
      domText: new Map(),
      domAttribute: new Map(),
    })
  })

  it('extracts the visible text of the body with collapsed whitespace', () => {
    const markup = Markup.extract(
      `<html><head><title>Title</title></head><body>
        <p>Ships   with
          <b>DPD</b> &amp; UPS</p>
        <script>var carrier = 'GLS'</script>
        <style>.carrier { color: red }</style>
      </body></html>`,
      'https://example.com/',
      requirementsOf({ Example: { text: ['\\bDPD\\b'] } })
    )
    expect(markup.text).toEqual(['Ships with DPD & UPS'])
  })

  it('extracts the text of a page without a body', () => {
    const markup = Markup.extract(
      'Ships with <b>DPD</b>',
      'https://example.com/',
      requirementsOf({ Example: { text: ['\\bDPD\\b'] } })
    )
    expect(markup.text).toEqual(['Ships with DPD'])
  })

  it('extracts the contents of inline style sheets', () => {
    const markup = Markup.extract(
      `<style>:root { --tw-rotate: 0 }</style>
        <style>  </style>
        <link rel="stylesheet" href="/style.css">
        <svg><style>.icon { fill: red }</style></svg>`,
      'https://example.com/',
      requirementsOf({ Example: { css: ['--tw-rotate'] } })
    )
    expect(markup.css).toEqual([
      ':root { --tw-rotate: 0 }',
      '.icon { fill: red }',
    ])
  })

  it('extracts the source of inline scripts', () => {
    const markup = Markup.extract(
      `<script>gtag('config', 'G-1')</script>
        <script src="/external.js"></script>
        <script> </script>
        <script type="application/ld+json">{"@type": "Organization"}</script>
        <script>if (a < b && c > d) {}</script>`,
      'https://example.com/',
      requirementsOf({ Example: { scripts: ['gtag'] } })
    )
    expect(markup.script).toEqual([
      "gtag('config', 'G-1')",
      '{"@type": "Organization"}',
      'if (a < b && c > d) {}',
    ])
  })

  it('extracts the absolute urls of external scripts', () => {
    const markup = Markup.extract(
      `<script src="/jquery-3.7.1.min.js"></script>
        <script src="vendor/vue.js"></script>
        <script src=" //cdn.example.net/a.js?b=1&amp;c=2 "></script>
        <script src="https://cdn.example.org/b.js"></script>
        <script src=""></script>
        <script>inline()</script>
        <script src="http://[invalid"></script>`,
      'https://example.com/shop/index.html',
      requirementsOf({ Example: { scriptSrc: ['jquery'] } })
    )
    expect(markup.scriptSrc).toEqual([
      'https://example.com/jquery-3.7.1.min.js',
      'https://example.com/shop/vendor/vue.js',
      'https://cdn.example.net/a.js?b=1&c=2',
      'https://cdn.example.org/b.js',
      'http://[invalid',
    ])
  })

  it('leaves out scripts embedded as data uris', () => {
    const markup = Markup.extract(
      `<script src="data:text/javascript;base64,YWxlcnQoMSk="></script>
        <script src=" DATA:application/javascript,jquery()"></script>
        <script src="&#1;data:text/javascript,jquery()"></script>
        <script src="da&#10;ta:text/javascript,jquery()"></script>
        <script src="/data:app.js"></script>`,
      'https://example.com/',
      requirementsOf({ Example: { scriptSrc: ['jquery'] } })
    )
    expect(markup.scriptSrc).toEqual(['https://example.com/data:app.js'])
  })

  it('resolves script urls against the base url of the document', () => {
    const markup = Markup.extract(
      `<head>
        <base target="_blank">
        <base href="/assets/">
        <base href="/ignored/">
      </head>
      <script src="app.js"></script>`,
      'https://example.com/shop/',
      requirementsOf({ Example: { scriptSrc: ['app'] } })
    )
    expect(markup.scriptSrc).toEqual(['https://example.com/assets/app.js'])
  })

  it('extracts the content of the meta tags the catalog asks for', () => {
    const markup = Markup.extract(
      `<meta name="Generator" content="WordPress 6.4.2">
        <meta name="generator" content="WooCommerce 8.4.0">
        <meta property="og:site_name" content="Example">
        <meta name="description" property="og:description" content="Shop">
        <meta name="shareaholic:wp_version">
        <meta name="viewport" content="width=device-width">
        <meta charset="utf-8">`,
      'https://example.com/',
      requirementsOf({
        Example: {
          meta: {
            generator: 'WordPress',
            'og:site_name': '',
            'og:description': '',
            description: '',
            'shareaholic:wp_version': '',
          },
        },
      })
    )
    expect(markup.meta).toEqual(
      new Map([
        ['generator', ['WordPress 6.4.2', 'WooCommerce 8.4.0']],
        ['og:site_name', ['Example']],
        ['description', ['Shop']],
        ['shareaholic:wp_version', ['']],
      ])
    )
  })

  it('extracts the selectors that exist in the document', () => {
    const markup = Markup.extract(
      `<body class="wp-site">
        <div id="wpadminbar"></div>
        <link rel="stylesheet" href="/wp-content/themes/a.css">
      </body>`,
      'https://example.com/',
      requirementsOf({
        Example: {
          dom: [
            '#wpadminbar',
            "link[rel=stylesheet][href*='/wp-content/']",
            "body[class*='wp-'] > div",
            '.missing',
            'div:unsupported',
            '[[invalid',
          ],
        },
      })
    )
    expect(markup.domExists).toEqual(
      new Set([
        '#wpadminbar',
        "link[rel=stylesheet][href*='/wp-content/']",
        "body[class*='wp-'] > div",
      ])
    )
  })

  it('extracts the non-empty trimmed text of every element a selector matches', () => {
    const markup = Markup.extract(
      `<head><title> Example Shop </title></head>
        <body>
          <span class="version"> GLPI version <b>10.0.1</b> </span>
          <span class="version"> </span>
          <img src="https://media.example.com/a.png">
        </body>`,
      'https://example.com/',
      requirementsOf({
        Example: {
          dom: {
            'head > title': { text: 'Shop' },
            '.version': { text: 'GLPI version ([\\d.]+)\\;version:\\1' },
            img: { text: '' },
            '.missing': { text: '' },
          },
        },
      })
    )
    expect(markup.domText).toEqual(
      new Map([
        ['head > title', ['Example Shop']],
        ['.version', ['GLPI version 10.0.1']],
      ])
    )
  })

  it('extracts the attributes the catalog asks for of every element a selector matches', () => {
    const markup = Markup.extract(
      `<link rel="stylesheet" HREF="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/a.css">
        <link rel="stylesheet" href="/b.css" title="B">
        <link rel="icon">
        <html ng-version="17.0.0" q:version="1.2.0"></html>`,
      'https://example.com/',
      requirementsOf({
        Example: {
          dom: {
            link: {
              attributes: { href: 'bootstrap@([\\d.]+)', title: '', id: '' },
            },
            '[ng-version]': { attributes: { 'ng-version': '' } },
            '[q\\:version]': { attributes: { 'q:version': '' } },
            '.missing': { attributes: { href: '' } },
          },
        },
      })
    )
    expect(markup.domAttribute).toEqual(
      new Map([
        [
          'link',
          new Map([
            [
              'href',
              ['https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/a.css', '/b.css'],
            ],
            ['title', ['B']],
          ]),
        ],
        ['[ng-version]', new Map([['ng-version', ['17.0.0']]])],
        ['[q\\:version]', new Map([['q:version', ['1.2.0']]])],
      ])
    )
  })
})
