import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'

import * as Technology from '#/technology.ts'

const decode = (fingerprint: object) =>
  Schema.decodeUnknownSync(Technology.FromJson)(
    { Example: { cats: [1], website: 'https://example.com', ...fingerprint } },
    { onExcessProperty: 'error' }
  ).get('Example')

const pattern = (regex: RegExp, confidence = 100) => ({
  regex,
  confidence,
  version: [],
})

describe('Technology.FromJson', () => {
  it('keys technologies by name and defaults the relations', () => {
    const technology = decode({
      description: 'An example.',
      oss: true,
      pricing: ['low'],
    })
    expect(technology).toBeInstanceOf(Technology.Technology)
    expect(technology).toEqual({
      name: 'Example',
      description: 'An example.',
      website: 'https://example.com',
      oss: true,
      pricing: ['low'],
      categories: [1],
      rules: [],
      implies: [],
      excludes: [],
      requires: [],
    })
  })

  it('turns every pattern into a rule', () => {
    expect(
      decode({
        url: ['u'],
        html: ['h'],
        text: ['t'],
        css: ['c'],
        robots: ['r'],
        scripts: ['s'],
        scriptSrc: ['ss'],
        xhr: ['x'],
        certIssuer: 'ci',
        headers: { 'X-Powered-By': 'hd' },
        cookies: { Session: 'ck' },
        meta: { Generator: 'm' },
        js: { 'jQuery.fn.jquery': 'j' },
        probe: { '/version': 'p' },
        dns: { MX: ['mx'], TXT: ['txt'] },
      })?.rules
    ).toEqual([
      { _tag: 'Url', pattern: pattern(/u/i) },
      { _tag: 'Html', pattern: pattern(/h/i) },
      { _tag: 'Text', pattern: pattern(/t/i) },
      { _tag: 'Css', pattern: pattern(/c/i) },
      { _tag: 'Robots', pattern: pattern(/r/i) },
      { _tag: 'Script', pattern: pattern(/s/i) },
      { _tag: 'ScriptSrc', pattern: pattern(/ss/i) },
      { _tag: 'Xhr', pattern: pattern(/x/i) },
      { _tag: 'CertIssuer', pattern: pattern(/ci/i) },
      { _tag: 'Header', name: 'x-powered-by', pattern: pattern(/hd/i) },
      { _tag: 'Cookie', name: 'session', pattern: pattern(/ck/i) },
      { _tag: 'Meta', name: 'generator', pattern: pattern(/m/i) },
      { _tag: 'Js', property: 'jQuery.fn.jquery', pattern: pattern(/j/i) },
      { _tag: 'Probe', path: '/version', pattern: pattern(/p/i) },
      { _tag: 'Dns', type: 'MX', pattern: pattern(/mx/i) },
      { _tag: 'Dns', type: 'TXT', pattern: pattern(/txt/i) },
    ])
  })

  it.each([
    ['a selector', '.example'],
    ['a list of selectors', ['.example']],
  ])('reads dom as %s', (_, dom) => {
    expect(decode({ dom })?.rules).toEqual([
      { _tag: 'DomExists', selector: '.example', confidence: 100, version: [] },
    ])
  })

  it('reads tags on dom selectors', () => {
    expect(decode({ dom: ['.example\\;confidence:40'] })?.rules).toEqual([
      { _tag: 'DomExists', selector: '.example', confidence: 40, version: [] },
    ])
  })

  it('splits a dom element into one rule per check', () => {
    expect(
      decode({
        dom: {
          'a.example': {
            exists: '\\;version:2',
            text: 'Example',
            attributes: { href: 'example\\.com' },
            properties: { _example: '' },
          },
        },
      })?.rules
    ).toEqual([
      {
        _tag: 'DomExists',
        selector: 'a.example',
        confidence: 100,
        version: [{ _tag: 'Text', value: '2' }],
      },
      { _tag: 'DomText', selector: 'a.example', pattern: pattern(/Example/i) },
      {
        _tag: 'DomAttribute',
        selector: 'a.example',
        attribute: 'href',
        pattern: pattern(/example\.com/i),
      },
      {
        _tag: 'DomProperty',
        selector: 'a.example',
        property: '_example',
        pattern: pattern(/(?:)/i),
      },
    ])
  })

  it('reads implies, excludes and requires', () => {
    const technology = decode({
      implies: ['PHP\\;confidence:50', 'Magento\\;version:2'],
      excludes: ['Other\\;confidence:50'],
      requires: ['WordPress\\;version:6'],
      requiresCategory: [6],
    })
    expect(technology?.implies[0]).toBeInstanceOf(Technology.Implication)
    expect(technology).toMatchObject({
      implies: [
        { name: 'PHP', confidence: 50, version: [] },
        {
          name: 'Magento',
          confidence: 100,
          version: [{ _tag: 'Text', value: '2' }],
        },
      ],
      excludes: ['Other'],
      requires: [
        { _tag: 'Technology', name: 'WordPress' },
        { _tag: 'Category', id: 6 },
      ],
    })
  })

  it.each([
    ['an empty category list', { cats: [] }, /cats/],
    ['an unknown field', { scriptsrc: ['x'] }, /scriptsrc/],
    ['an unknown dns record type', { dns: { HTTPS: ['x'] } }, /HTTPS/],
    ['an unknown pricing', { pricing: ['cheap'] }, /pricing/],
    ['a pattern on dom exists', { dom: { a: { exists: 'x' } } }, /only tags/],
    ['an invalid regex', { headers: { Server: '(' } }, /\["Server"\]/],
  ])('rejects %s', (_, fingerprint, message) => {
    expect(() => decode(fingerprint)).toThrow(message)
  })
})
