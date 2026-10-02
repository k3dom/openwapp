import { describe, expect, it } from '@effect/vitest'
import fingerprints from '@openwapp/fingerprints'

import * as Catalog from '#/catalog.ts'
import * as Observation from '#/observation.ts'
import * as Requirements from '#/requirements.ts'

type Fields = ConstructorParameters<typeof Requirements.Requirements>[0]

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

const nothing: Fields = {
  url: false,
  html: false,
  text: false,
  css: false,
  robots: false,
  script: false,
  scriptSrc: false,
  xhr: false,
  certIssuer: false,
  header: new Set(),
  cookie: new Set(),
  meta: new Set(),
  js: new Set(),
  dns: new Set(),
  probe: new Set(),
  domExists: new Set(),
  domText: new Set(),
  domAttribute: new Map(),
  domProperty: new Map(),
}

describe('Requirements', () => {
  it('has one field per observation field', () => {
    expect(Object.keys(Requirements.Requirements.fields)).toEqual(
      Object.keys(Observation.Observation.fields)
    )
  })
})

describe('Requirements.fromCatalog', () => {
  it('requires nothing for technologies without rules', () => {
    const requirements = requirementsOf({
      Example: { implies: ['Other'] },
      Other: {},
    })
    expect(requirements).toBeInstanceOf(Requirements.Requirements)
    expect(requirements).toEqual(nothing)
  })

  it.each<[string, object, Partial<Fields>]>([
    ['url', { url: ['^https://'] }, { url: true }],
    ['html', { html: ['<main'] }, { html: true }],
    ['text', { text: ['Powered by'] }, { text: true }],
    ['css', { css: ['\\.example'] }, { css: true }],
    ['robots', { robots: ['Disallow: /x/'] }, { robots: true }],
    ['script', { scripts: ['example\\('] }, { script: true }],
    ['scriptSrc', { scriptSrc: ['example\\.js'] }, { scriptSrc: true }],
    ['xhr', { xhr: ['api\\.example'] }, { xhr: true }],
    ['certIssuer', { certIssuer: 'Example CA' }, { certIssuer: true }],
    [
      'header',
      { headers: { 'X-Powered-By': 'Example', Server: '' } },
      { header: new Set(['x-powered-by', 'server']) },
    ],
    ['cookie', { cookies: { Session: '' } }, { cookie: new Set(['session']) }],
    [
      'meta',
      { meta: { Generator: 'Example' } },
      { meta: new Set(['generator']) },
    ],
    [
      'js',
      { js: { 'Example.version': '', Example: '' } },
      { js: new Set(['Example.version', 'Example']) },
    ],
    [
      'dns',
      { dns: { MX: ['mx\\.example'], TXT: ['spf'] } },
      { dns: new Set(['MX', 'TXT']) },
    ],
    [
      'probe',
      { probe: { '/version': 'Example' } },
      { probe: new Set(['/version']) },
    ],
    ['domExists', { dom: ['#example'] }, { domExists: new Set(['#example']) }],
    [
      'domText',
      { dom: { footer: { text: 'Example' } } },
      { domText: new Set(['footer']) },
    ],
    [
      'domAttribute',
      { dom: { link: { attributes: { href: 'example', rel: '' } } } },
      { domAttribute: new Map([['link', new Set(['href', 'rel'])]]) },
    ],
    [
      'domProperty',
      { dom: { div: { properties: { _example: '' } } } },
      { domProperty: new Map([['div', new Set(['_example'])]]) },
    ],
  ])('requires %s for its rules', (_, fingerprint, fields) => {
    expect(requirementsOf({ Example: fingerprint })).toEqual({
      ...nothing,
      ...fields,
    })
  })

  it('splits one dom selector into the fields its rules test', () => {
    expect(
      requirementsOf({
        Example: {
          dom: {
            '#example': {
              exists: '',
              text: 'Example',
              attributes: { id: '' },
              properties: { _example: '' },
            },
          },
        },
      })
    ).toEqual({
      ...nothing,
      domExists: new Set(['#example']),
      domText: new Set(['#example']),
      domAttribute: new Map([['#example', new Set(['id'])]]),
      domProperty: new Map([['#example', new Set(['_example'])]]),
    })
  })

  it('merges the keys of every technology', () => {
    expect(
      requirementsOf({
        Example: {
          headers: { 'X-Powered-By': 'Example' },
          dom: { link: { attributes: { href: 'example' } } },
        },
        Other: {
          headers: { 'x-powered-by': 'Other', Server: 'Other' },
          dom: { link: { attributes: { href: 'other', rel: 'other' } } },
        },
      })
    ).toEqual({
      ...nothing,
      header: new Set(['x-powered-by', 'server']),
      domAttribute: new Map([['link', new Set(['href', 'rel'])]]),
    })
  })

  it('includes rules that only extract a version or wait for a required technology', () => {
    expect(
      requirementsOf({
        Example: {
          js: { 'Example.version': '^(.+)$\\;confidence:0\\;version:\\1' },
        },
        Plugin: { js: { Plugin: '' }, requires: ['Example'] },
      })
    ).toEqual({ ...nothing, js: new Set(['Example.version', 'Plugin']) })
  })

  it('lists what to gather for the upstream fingerprints', () => {
    const requirements = Requirements.fromCatalog(
      Catalog.decodeSync(fingerprints)
    )

    expect(requirements.url).toBe(true)
    expect(requirements.robots).toBe(true)
    expect([...requirements.js]).toEqual(
      expect.arrayContaining(['jQuery.fn.jquery', '_.VERSION'])
    )
    expect([...requirements.meta]).toContain('generator')
    expect([...requirements.header]).toContain('x-powered-by')
    expect([...requirements.dns]).toEqual(expect.arrayContaining(['MX', 'TXT']))
  })
})
