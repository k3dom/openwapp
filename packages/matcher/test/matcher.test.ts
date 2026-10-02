import { describe, expect, it } from '@effect/vitest'
import fingerprints from '@openwapp/fingerprints'

import * as Catalog from '#/catalog.ts'
import * as Matcher from '#/matcher.ts'
import * as Observation from '#/observation.ts'

type Fields = ConstructorParameters<typeof Observation.Observation>[0]

const catalogOf = (technologies: Record<string, object>) =>
  Catalog.decodeSync({
    technologies: Object.fromEntries(
      Object.entries(technologies).map(([name, technology]) => [
        name,
        { cats: [1], website: 'https://example.com', ...technology },
      ])
    ),
    categories: {
      1: { name: 'CMS', priority: 1, groups: [1] },
      2: { name: 'Ecommerce', priority: 1, groups: [1] },
    },
    groups: { 1: { name: 'Content' } },
  })

const detect = (technologies: Record<string, object>, fields: Fields) =>
  Matcher.match(
    catalogOf(technologies),
    new Observation.Observation(fields)
  ).map(({ technology, confidence, version }) => ({
    name: technology.name,
    confidence,
    ...(version === undefined ? {} : { version }),
  }))

const example = { name: 'Example', confidence: 100 }

describe('Matcher.match', () => {
  it('returns detections that point to the catalog technologies', () => {
    const catalog = catalogOf({ Example: { url: ['example'] } })
    const [detection] = Matcher.match(
      catalog,
      new Observation.Observation({ url: ['https://example.com/'] })
    )
    expect(detection).toBeInstanceOf(Matcher.Detection)
    expect(detection?.technology).toBe(catalog.technologies.get('Example'))
  })

  it.each<[string, object, Fields]>([
    ['url', { url: ['^https://'] }, { url: ['https://example.com/'] }],
    ['html', { html: ['<main'] }, { html: ['<main id="app">'] }],
    ['text', { text: ['Powered by'] }, { text: ['Powered by Example'] }],
    ['css', { css: ['\\.example'] }, { css: ['.example { color: red }'] }],
    ['robots', { robots: ['Disallow: /x/'] }, { robots: ['Disallow: /x/'] }],
    ['script', { scripts: ['example\\('] }, { script: ['example()'] }],
    [
      'scriptSrc',
      { scriptSrc: ['example\\.js'] },
      { scriptSrc: ['/example.js'] },
    ],
    ['xhr', { xhr: ['api\\.example'] }, { xhr: ['api.example.com'] }],
    [
      'certIssuer',
      { certIssuer: 'Example CA' },
      { certIssuer: ['Example CA'] },
    ],
    [
      'header',
      { headers: { 'X-Powered-By': 'Example' } },
      { header: new Map([['x-powered-by', ['Example']]]) },
    ],
    [
      'cookie',
      { cookies: { session: '' } },
      { cookie: new Map([['session', ['1']]]) },
    ],
    [
      'a cookie name with a wildcard',
      { cookies: { '_GA_*': '' } },
      { cookie: new Map([['_ga_l7xq2bxp4n', ['GS1.1']]]) },
    ],
    [
      'meta',
      { meta: { generator: 'Example' } },
      { meta: new Map([['generator', ['Example']]]) },
    ],
    [
      'js',
      { js: { 'Example.init': '' } },
      { js: new Map([['Example.init', ['true']]]) },
    ],
    [
      'dns',
      { dns: { MX: ['mx\\.example'] } },
      { dns: new Map([['MX', ['mx.example.com']]]) },
    ],
    [
      'probe',
      { probe: { '/version': 'Example' } },
      { probe: new Map([['/version', ['Example 1.0']]]) },
    ],
    ['domExists', { dom: ['#example'] }, { domExists: new Set(['#example']) }],
    [
      'domText',
      { dom: { footer: { text: 'Example' } } },
      { domText: new Map([['footer', ['Made with Example']]]) },
    ],
    [
      'domAttribute',
      { dom: { link: { attributes: { href: 'example' } } } },
      { domAttribute: new Map([['link', new Map([['href', ['/example']]])]]) },
    ],
    [
      'domProperty',
      { dom: { div: { properties: { _example: '' } } } },
      { domProperty: new Map([['div', new Map([['_example', ['true']]])]]) },
    ],
  ])('tests a rule against %s', (_, fingerprint, fields) => {
    expect(detect({ Example: fingerprint }, fields)).toEqual([example])
  })

  it.each<[string, object, Fields]>([
    ['no value matches', { url: ['^https://'] }, { url: ['http://a/'] }],
    [
      'the value sits under another key',
      { headers: { Server: '' } },
      { header: new Map([['via', ['Example']]]) },
    ],
    [
      'the value sits under another selector',
      { dom: { a: { attributes: { href: '' } } } },
      { domAttribute: new Map([['link', new Map([['href', ['/']]])]]) },
    ],
    [
      'a cookie name differs outside its wildcard',
      { cookies: { 'a.b_*': '' } },
      { cookie: new Map([['axb_1', ['1']]]) },
    ],
    [
      'the selector did not match',
      { dom: ['#a'] },
      { domExists: new Set(['#b']) },
    ],
  ])('detects nothing when %s', (_, fingerprint, fields) => {
    expect(detect({ Example: fingerprint }, fields)).toEqual([])
  })

  describe('confidence', () => {
    it('adds up the matching rules and caps the sum at 100', () => {
      const technologies = (count: number) => ({
        Example: {
          html: ['a', 'b', 'c', 'd'].slice(0, count).map((value) => {
            return `${value}\\;confidence:40`
          }),
        },
      })
      expect(detect(technologies(2), { html: ['abcd'] })).toEqual([
        { name: 'Example', confidence: 80 },
      ])
      expect(detect(technologies(3), { html: ['abcd'] })).toEqual([example])
    })

    it('counts a rule once however many values it matches', () => {
      expect(
        detect(
          { Example: { scriptSrc: ['example\\;confidence:50'] } },
          { scriptSrc: ['/example-a.js', '/example-b.js'] }
        )
      ).toEqual([{ name: 'Example', confidence: 50 }])
    })

    it('keeps the version but drops the detection of a zero confidence rule', () => {
      const technologies = {
        Example: {
          js: {
            'Example.version': '^(.+)$\\;confidence:0\\;version:\\1',
            'Example.init': '',
          },
        },
      }
      expect(
        detect(technologies, {
          js: new Map([['Example.version', ['1.2.3']]]),
        })
      ).toEqual([])
      expect(
        detect(technologies, {
          js: new Map([
            ['Example.version', ['1.2.3']],
            ['Example.init', ['true']],
          ]),
        })
      ).toEqual([{ ...example, version: '1.2.3' }])
    })
  })

  describe('version', () => {
    it.each([
      ['a capture', 'example-([\\d.]+)', '\\1', 'example-1.2.3', '1.2.3'],
      ['text and a capture', 'v(\\d)', 'API v\\1', 'v2', 'API v2'],
      ['a present conditional', '(pro)?', '\\1?Pro:Free', 'pro', 'Pro'],
      ['an absent conditional', '(pro)?', '\\1?Pro:Free', 'basic', 'Free'],
      ['a missing capture', '(\\d)?x', '\\1', 'x', undefined],
      [
        'a capture of 10 characters',
        '^(.+)$',
        '\\1',
        '1.2.3-rc.4',
        '1.2.3-rc.4',
      ],
      [
        'a capture over 10 characters',
        '^(.+)$',
        '\\1',
        '1.2.3-rc.45',
        undefined,
      ],
      [
        'text beside a long capture',
        '^(.+)$',
        'v\\1',
        '1.2.3-rc.45',
        undefined,
      ],
      [
        'a conditional on a long capture',
        '^(.+)$',
        '\\1?2+:',
        'f0e1d2c3b4a5',
        '2+',
      ],
    ])('resolves %s', (_, regex, template, value, version) => {
      expect(
        detect(
          { Example: { url: [`${regex}\\;version:${template}`] } },
          { url: [value] }
        )
      ).toEqual([{ ...example, ...(version === undefined ? {} : { version }) }])
    })

    it('resolves the version of a dom selector without captures', () => {
      expect(
        detect(
          { Example: { dom: ['#example\\;version:\\1?a:2'] } },
          { domExists: new Set(['#example']) }
        )
      ).toEqual([{ ...example, version: '2' }])
    })

    it('picks the longest version', () => {
      expect(
        detect(
          { Example: { url: ['(\\d+(?:\\.\\d+)*)\\;version:\\1'] } },
          { url: ['/1.2', '/1.2.3', '/2.0'] }
        )
      ).toEqual([{ ...example, version: '1.2.3' }])
    })

    it.each([
      ['longer than 15 characters', '1.2.3-\\1', 'beta.12345'],
      ['that looks like a timestamp', '\\1', '1712345678'],
    ])('ignores a version %s', (_, template, value) => {
      expect(
        detect(
          {
            Example: {
              js: {
                'Example.version': '^(.+)$\\;version:\\1',
                'Example.build': `^(.+)$\\;version:${template}`,
              },
            },
          },
          {
            js: new Map([
              ['Example.version', ['1.2']],
              ['Example.build', [value]],
            ]),
          }
        )
      ).toEqual([{ ...example, version: '1.2' }])
    })
  })

  describe('excludes', () => {
    it('removes the technologies a detection excludes', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], excludes: ['Other'] },
            Other: { url: ['example'] },
          },
          { url: ['https://example.com/'] }
        )
      ).toEqual([example])
    })

    it.each([
      ['Example', 'a\\;confidence:90', 'b\\;confidence:50', 90],
      ['Other', 'a\\;confidence:50', 'b\\;confidence:90', 90],
    ])(
      'keeps %s when two technologies exclude each other',
      (name, example, other, confidence) => {
        expect(
          detect(
            {
              Example: { url: [example], excludes: ['Other'] },
              Other: { url: [other], excludes: ['Example'] },
            },
            { url: ['ab'] }
          )
        ).toEqual([{ name, confidence }])
      }
    )

    it('removes both of two equally confident technologies that exclude each other', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], excludes: ['Other'] },
            Other: { url: ['example'], excludes: ['Example'] },
          },
          { url: ['https://example.com/'] }
        )
      ).toEqual([])
    })

    it.each([
      ['before', ['Excluder', 'Middle', 'Last']],
      ['after', ['Middle', 'Excluder', 'Last']],
    ])(
      'applies the excludes of an excluded technology listed %s its excluder',
      (_, order) => {
        const fingerprints: Record<string, object> = {
          Excluder: { url: ['example'], excludes: ['Middle'] },
          Middle: { url: ['example'], excludes: ['Last'] },
          Last: { url: ['example'] },
        }
        expect(
          detect(
            Object.fromEntries(
              order.map((name) => [name, fingerprints[name] ?? {}])
            ),
            { url: ['https://example.com/'] }
          )
        ).toEqual([{ name: 'Excluder', confidence: 100 }])
      }
    )

    it('ignores the excludes of a zero confidence detection', () => {
      expect(
        detect(
          {
            Example: { url: ['example'] },
            Other: { url: ['example\\;confidence:0'], excludes: ['Example'] },
          },
          { url: ['https://example.com/'] }
        )
      ).toEqual([example])
    })

    it('never implies an excluded technology', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], excludes: ['Other'] },
            Implier: { url: ['example'], implies: ['Other'] },
            Other: {},
          },
          { url: ['https://example.com/'] }
        )
      ).toEqual([example, { name: 'Implier', confidence: 100 }])
    })
  })

  describe('implies', () => {
    it('adds implied technologies with the lower of both confidences', () => {
      expect(
        detect(
          {
            Example: {
              url: ['example\\;confidence:80'],
              implies: ['Strong', 'Weak\\;confidence:50'],
            },
            Strong: {},
            Weak: {},
          },
          { url: ['https://example.com/'] }
        )
      ).toEqual([
        { name: 'Example', confidence: 80 },
        { name: 'Strong', confidence: 80 },
        { name: 'Weak', confidence: 50 },
      ])
    })

    it('follows chains of implications', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], implies: ['Middle'] },
            Middle: { implies: ['Last'] },
            Last: {},
          },
          { url: ['https://example.com/'] }
        ).map(({ name }) => name)
      ).toEqual(['Example', 'Middle', 'Last'])
    })

    it('takes the version of an implication', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], implies: ['Other\\;version:2'] },
            Other: {},
          },
          { url: ['https://example.com/'] }
        )
      ).toContainEqual({ name: 'Other', confidence: 100, version: '2' })
    })

    it('keeps the more specific version of a detection', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], implies: ['Other\\;version:2'] },
            Other: { url: ['other/([\\d.]+)\\;version:\\1'] },
          },
          { url: ['https://example.com/other/2.4.1'] }
        )
      ).toContainEqual({ name: 'Other', confidence: 100, version: '2.4.1' })
    })

    it('takes the version of a zero confidence rule on an implied technology', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], implies: ['Other'] },
            Other: {
              js: { 'Other.version': '^(.+)$\\;confidence:0\\;version:\\1' },
            },
          },
          {
            url: ['https://example.com/'],
            js: new Map([['Other.version', ['1.2.3']]]),
          }
        )
      ).toContainEqual({ name: 'Other', confidence: 100, version: '1.2.3' })
    })

    it('raises the confidence of a weaker detection', () => {
      expect(
        detect(
          {
            Example: { url: ['example'], implies: ['Other'] },
            Other: { url: ['example\\;confidence:30'] },
          },
          { url: ['https://example.com/'] }
        )
      ).toEqual([example, { name: 'Other', confidence: 100 }])
    })

    it('keeps the strongest of several implications', () => {
      expect(
        detect(
          {
            Example: { url: ['a\\;confidence:40'], implies: ['Other'] },
            Implier: { url: ['b\\;confidence:90'], implies: ['Other'] },
            Other: {},
          },
          { url: ['ab'] }
        )
      ).toContainEqual({ name: 'Other', confidence: 90 })
    })

    it('lists implied technologies in catalog order', () => {
      expect(
        detect(
          { Alpha: {}, Zulu: { url: ['example'], implies: ['Alpha'] } },
          { url: ['https://example.com/'] }
        ).map(({ name }) => name)
      ).toEqual(['Alpha', 'Zulu'])
    })
  })

  describe('requires', () => {
    const plugin = { url: ['plugin'], requires: ['Example'] }

    it('matches a technology only once a required technology is detected', () => {
      expect(
        detect(
          { Example: { url: ['example'] }, Plugin: plugin },
          { url: ['/plugin/'] }
        )
      ).toEqual([])
      expect(
        detect(
          { Example: { url: ['example'] }, Plugin: plugin },
          { url: ['https://example.com/plugin/'] }
        )
      ).toEqual([example, { name: 'Plugin', confidence: 100 }])
    })

    it('counts implied technologies as detected', () => {
      expect(
        detect(
          {
            Example: {},
            Implier: { url: ['implier'], implies: ['Example'] },
            Plugin: plugin,
          },
          { url: ['/implier/plugin/'] }
        ).map(({ name }) => name)
      ).toEqual(['Example', 'Implier', 'Plugin'])
    })

    it('needs only one of several required technologies', () => {
      expect(
        detect(
          {
            Example: { url: ['example'] },
            Other: { url: ['other'] },
            Plugin: { url: ['plugin'], requires: ['Example', 'Other'] },
          },
          { url: ['/other/plugin/'] }
        ).map(({ name }) => name)
      ).toEqual(['Other', 'Plugin'])
    })

    it('matches a technology once a technology in its required category is detected', () => {
      const technologies = {
        Shop: { cats: [2], url: ['shop'] },
        Plugin: { url: ['plugin'], requiresCategory: [2] },
      }
      expect(detect(technologies, { url: ['/plugin/'] })).toEqual([])
      expect(
        detect(technologies, { url: ['/shop/plugin/'] }).map(({ name }) => name)
      ).toEqual(['Shop', 'Plugin'])
    })

    it('follows chains of requirements', () => {
      expect(
        detect(
          {
            Example: { url: ['example'] },
            Plugin: plugin,
            Addon: { url: ['addon'], requires: ['Plugin'] },
          },
          { url: ['/example/plugin/addon/'] }
        ).map(({ name }) => name)
      ).toEqual(['Example', 'Plugin', 'Addon'])
    })

    it('applies the excludes of technologies matched through requirements', () => {
      expect(
        detect(
          {
            Example: { url: ['example'] },
            Plugin: { ...plugin, excludes: ['Other'] },
            Other: { url: ['example'] },
          },
          { url: ['/example/plugin/'] }
        ).map(({ name }) => name)
      ).toEqual(['Example', 'Plugin'])
    })

    it('lets a technology replace the technology it requires', () => {
      expect(
        detect(
          {
            Example: { url: ['example'] },
            Plugin: { ...plugin, excludes: ['Example'] },
          },
          { url: ['/example/plugin/'] }
        ).map(({ name }) => name)
      ).toEqual(['Plugin'])
    })

    it('matches an implied technology without its requirements', () => {
      expect(
        detect(
          {
            Example: {},
            Implier: { url: ['implier'], implies: ['Plugin'] },
            Plugin: {
              url: ['plugin/(\\d)\\;version:\\1'],
              requires: ['Example'],
            },
          },
          { url: ['/implier/plugin/2'] }
        )
      ).toContainEqual({ name: 'Plugin', confidence: 100, version: '2' })
    })
  })

  it('detects technologies with the upstream fingerprints', () => {
    const catalog = Catalog.decodeSync(fingerprints)
    const observation = new Observation.Observation({
      meta: new Map([['generator', ['WordPress 6.5.2']]]),
      header: new Map([['x-powered-by', ['PHP/8.3.0']]]),
      cookie: new Map([
        ['_ga_l7xq2bxp4n', ['GS1.1.1700000000.1.0.1700000000.0']],
      ]),
      scriptSrc: [
        'https://example.com/wp-content/plugins/woocommerce/assets/js/frontend/woocommerce.min.js?ver=8.7.0',
      ],
      js: new Map([
        ['jQuery.fn.jquery', ['3.7.1']],
        ['_.VERSION', ['1.13.6']],
        ['_.restArguments', ['true']],
      ]),
    })

    const detections = Matcher.match(catalog, observation).map(
      ({ technology, confidence, version }) =>
        `${technology.name} ${version ?? '-'} ${confidence}`
    )

    expect(detections).toEqual(
      expect.arrayContaining([
        'WordPress 6.5.2 100',
        'WooCommerce 8.7.0 100',
        'PHP 8.3.0 100',
        'MySQL - 100',
        'jQuery 3.7.1 100',
        'Underscore.js 1.13.6 100',
        'Google Analytics GA4 100',
      ])
    )
    expect(detections).not.toContainEqual(expect.stringMatching(/^Lodash /))
  })
})
