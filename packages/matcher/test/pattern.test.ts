import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'

import * as Pattern from '#/pattern.ts'

const decode = Schema.decodeUnknownSync(Pattern.FromString)

describe('Pattern.FromString', () => {
  it('compiles a case-insensitive regex with full confidence and no version', () => {
    const pattern = decode('^WordPress$')
    expect(pattern).toBeInstanceOf(Pattern.Pattern)
    expect(pattern).toEqual({
      regex: /^WordPress$/i,
      confidence: 100,
      version: [],
    })
  })

  it('reads the confidence and version tags', () => {
    expect(
      decode('jquery-([0-9.]+)\\.js\\;confidence:50\\;version:\\1')
    ).toEqual({
      regex: /jquery-([0-9.]+)\.js/i,
      confidence: 50,
      version: [{ _tag: 'Capture', group: 1 }],
    })
  })

  it('treats an empty pattern as matching anything', () => {
    const pattern = decode('\\;confidence:25')
    expect(pattern.regex.test('anything')).toBe(true)
    expect(pattern.confidence).toBe(25)
  })

  it.each([
    ['2+', [{ _tag: 'Text', value: '2+' }]],
    [
      'API v\\1',
      [
        { _tag: 'Text', value: 'API v' },
        { _tag: 'Capture', group: 1 },
      ],
    ],
    [
      '\\1.\\2',
      [
        { _tag: 'Capture', group: 1 },
        { _tag: 'Text', value: '.' },
        { _tag: 'Capture', group: 2 },
      ],
    ],
    [
      '\\1?1 (Enterprise):1 (Community)',
      [
        {
          _tag: 'Conditional',
          group: 1,
          present: '1 (Enterprise)',
          absent: '1 (Community)',
        },
      ],
    ],
    [
      'v\\1?:b',
      [
        { _tag: 'Text', value: 'v' },
        { _tag: 'Conditional', group: 1, present: '', absent: 'b' },
      ],
    ],
  ])('parses the version template %s', (template, version) => {
    expect(decode(`(a)?(b)?\\;version:${template}`).version).toEqual(version)
  })

  it.each([
    ['an invalid regex', '(', /Invalid regular expression/],
    ['an unknown tag', 'a\\;confidnce:50', /got "confidnce:50"/],
    ['a confidence above 100', 'a\\;confidence:150', /between 0 and 100/],
    ['a non-numeric confidence', 'a\\;confidence:high', /\^\\d\+\$/],
  ])('rejects %s', (_, input, message) => {
    expect(() => decode(input)).toThrow(message)
  })
})
