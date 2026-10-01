import { describe, expect, it } from '@effect/vitest'
import { SchemaIssue } from 'effect'

import * as Observation from '#/observation.ts'
import * as Rule from '#/rule.ts'

const issueMessage = (make: () => unknown) => {
  try {
    make()
  } catch (error) {
    if (error instanceof Error && SchemaIssue.isIssue(error.cause)) {
      return SchemaIssue.makeFormatterDefault()(error.cause)
    }
    throw error
  }
  throw new Error('Expected the constructor to throw')
}

describe('Observation', () => {
  it('has one field per rule tag', () => {
    expect(Object.keys(Observation.Observation.fields).toSorted()).toEqual(
      Object.keys(Rule.Rule.cases)
        .map((tag) => tag[0]?.toLowerCase() + tag.slice(1))
        .toSorted()
    )
  })

  it('defaults every field to empty', () => {
    expect(new Observation.Observation({})).toEqual({
      url: [],
      html: [],
      text: [],
      css: [],
      robots: [],
      script: [],
      scriptSrc: [],
      xhr: [],
      certIssuer: [],
      header: new Map(),
      cookie: new Map(),
      meta: new Map(),
      js: new Map(),
      dns: new Map(),
      probe: new Map(),
      domExists: new Set(),
      domText: new Map(),
      domAttribute: new Map(),
      domProperty: new Map(),
    })
  })

  it('keeps what was observed', () => {
    const observation = new Observation.Observation({
      url: ['https://example.com/'],
      header: new Map([['set-cookie', ['a=1', 'b=2']]]),
      dns: new Map([['TXT', ['v=spf1']]]),
      domExists: new Set(['#app']),
      domAttribute: new Map([['a', new Map([['href', ['/', '/about']]])]]),
    })
    expect(observation.url).toEqual(['https://example.com/'])
    expect(observation.header.get('set-cookie')).toEqual(['a=1', 'b=2'])
    expect(observation.dns.get('TXT')).toEqual(['v=spf1'])
    expect(observation.domExists.has('#app')).toBe(true)
    expect(observation.domAttribute.get('a')?.get('href')).toEqual([
      '/',
      '/about',
    ])
  })

  it.each<[string, ConstructorParameters<typeof Observation.Observation>[0]]>([
    ['a header', { header: new Map([['Server', ['nginx']]]) }],
    ['a cookie', { cookie: new Map([['Session', ['1']]]) }],
    ['a meta', { meta: new Map([['Generator', ['WordPress']]]) }],
  ])('rejects %s name with uppercase letters', (_, fields) => {
    expect(issueMessage(() => new Observation.Observation(fields))).toMatch(
      /in lowercase/
    )
  })

  it.each([
    ['a keyed field', { js: new Map([['jQuery', []]]) }],
    [
      'a field keyed by selector and name',
      { domProperty: new Map([['a', new Map([['_example', []]])]]) },
    ],
  ])('rejects a key without values in %s', (_, fields) => {
    expect(
      // @ts-expect-error a present key needs at least one value
      issueMessage(() => new Observation.Observation(fields))
    ).toMatch(/Missing key\n  at .*\[1\]\[0\]$/)
  })

  it('rejects an unknown dns record type', () => {
    expect(
      issueMessage(
        () =>
          new Observation.Observation({
            // @ts-expect-error HTTPS is not a known record type
            dns: new Map([['HTTPS', ['1 .']]]),
          })
      )
    ).toMatch(/"TXT"\n  at \["dns"\]/)
  })
})
