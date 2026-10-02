import {
  Array,
  Effect,
  Schema,
  SchemaGetter,
  SchemaIssue,
  SchemaTransformation,
  Struct,
} from 'effect'

import * as Category from '#/category.ts'
import * as Group from '#/group.ts'
import * as Pattern from '#/pattern.ts'
import * as Rule from '#/rule.ts'
import * as Technology from '#/technology.ts'

export const TaggedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Struct({
      value: Schema.String,
      confidence: Schema.String.check(Schema.isPattern(/^\d+$/)).pipe(
        Schema.decodeTo(
          Pattern.Confidence,
          SchemaTransformation.numberFromString
        )
      ),
      version: Schema.String.pipe(
        Schema.decodeTo(Pattern.Version, {
          decode: SchemaGetter.transform((template) => {
            const [, head = template, group, present = '', absent = ''] =
              /^(.*?)\\(\d)\?([^:]*):(.*)$/s.exec(template) ?? []
            const parts = head
              .split(/\\(\d)/)
              .flatMap((text, index): ReadonlyArray<Pattern.VersionPart> => {
                if (index % 2 === 1) {
                  return [{ _tag: 'Capture', group: Number(text) }]
                }
                return text === '' ? [] : [{ _tag: 'Text', value: text }]
              })
            return group === undefined
              ? parts
              : [
                  ...parts,
                  {
                    _tag: 'Conditional',
                    group: Number(group),
                    present,
                    absent,
                  },
                ]
          }),
          encode: SchemaGetter.forbiddenEncoding,
        })
      ),
    }),
    {
      decode: SchemaGetter.transformEffect((input, options) => {
        const [value = '', ...tags] = input.split('\\;')
        let confidence = '100'
        let version = ''
        for (const tag of tags) {
          const [, key, argument = ''] =
            /^(confidence|version):(.*)$/s.exec(tag) ?? []
          if (key === 'confidence') confidence = argument
          else if (key === 'version') version = argument
          else {
            return Effect.fail(
              new SchemaIssue.InvalidValue(
                {
                  message: `Expected a confidence or version tag, got "${tag}"`,
                },
                input,
                options
              )
            )
          }
        }
        return Effect.succeed({ value, confidence, version })
      }),
      encode: SchemaGetter.forbiddenEncoding,
    }
  )
)

export const PatternString = TaggedString.pipe(
  Schema.decodeTo(Pattern.Pattern, {
    decode: SchemaGetter.transformEffect(
      ({ value, confidence, version }, options) =>
        Effect.try({
          try: () => ({
            // Bounded quantifiers keep a pattern from backtracking across a
            // whole page.
            regex: new RegExp(
              value.replace(
                /\\.|\[(?:\\.|[^\\\]])*\]|[+*]|\{(\d+),\}/gs,
                (token, minimum?: string) => {
                  if (token === '+') return '{1,250}'
                  if (token === '*') return '{0,250}'
                  if (minimum === undefined) return token
                  return `{${minimum},${Math.max(Number(minimum), 250)}}`
                }
              ),
              'i'
            ),
            confidence,
            version,
          }),
          catch: (error) =>
            new SchemaIssue.InvalidValue(
              { message: String(error) },
              value,
              options
            ),
        })
    ),
    encode: SchemaGetter.forbiddenEncoding,
  })
)

const Rules = Schema.Array(Rule.Rule)

const patterns = (toRule: (pattern: Pattern.Pattern) => Rule.Rule) =>
  Schema.Array(PatternString).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((patterns) => patterns.map(toRule)),
      encode: SchemaGetter.forbiddenEncoding,
    })
  )

const keyedPatterns = (
  toRule: (key: string, pattern: Pattern.Pattern) => Rule.Rule
) =>
  Schema.Record(Schema.String, PatternString).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((patterns) =>
        Object.entries(patterns).map(([key, pattern]) => toRule(key, pattern))
      ),
      encode: SchemaGetter.forbiddenEncoding,
    })
  )

const TechnologyName = TaggedString.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform(({ value }) => value),
    encode: SchemaGetter.forbiddenEncoding,
  })
)

const Selectors = Schema.Array(TaggedString).pipe(
  Schema.decodeTo(Rules, {
    decode: SchemaGetter.transform((selectors) =>
      selectors.map(({ value, confidence, version }) => ({
        _tag: 'DomExists',
        selector: value,
        confidence,
        version,
      }))
    ),
    encode: SchemaGetter.forbiddenEncoding,
  })
)

const Dom = Schema.Union([
  Schema.toCodecArrayFromSingle(Selectors),
  Schema.Record(
    Schema.String,
    Schema.Struct({
      exists: Schema.optionalKey(
        TaggedString.check(
          Schema.makeFilter(
            ({ value }) => value === '' || `Expected only tags, got "${value}"`
          )
        )
      ),
      text: Schema.optionalKey(PatternString),
      attributes: Schema.optionalKey(
        Schema.Record(Schema.String, PatternString)
      ),
      properties: Schema.optionalKey(
        Schema.Record(Schema.String, PatternString)
      ),
    })
  ).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((elements) =>
        Object.entries(elements).flatMap(
          ([selector, { exists, text, attributes = {}, properties = {} }]) => [
            ...Array.fromNullishOr(exists).map(({ confidence, version }) => ({
              _tag: 'DomExists' as const,
              selector,
              confidence,
              version,
            })),
            ...Array.fromNullishOr(text).map((pattern) => ({
              _tag: 'DomText' as const,
              selector,
              pattern,
            })),
            ...Object.entries(attributes).map(([attribute, pattern]) => ({
              _tag: 'DomAttribute' as const,
              selector,
              attribute,
              pattern,
            })),
            ...Object.entries(properties).map(([property, pattern]) => ({
              _tag: 'DomProperty' as const,
              selector,
              property,
              pattern,
            })),
          ]
        )
      ),
      encode: SchemaGetter.forbiddenEncoding,
    })
  ),
])

const sources = {
  url: patterns((pattern) => ({ _tag: 'Url', pattern })),
  html: patterns((pattern) => ({ _tag: 'Html', pattern })),
  text: patterns((pattern) => ({ _tag: 'Text', pattern })),
  css: patterns((pattern) => ({ _tag: 'Css', pattern })),
  robots: patterns((pattern) => ({ _tag: 'Robots', pattern })),
  scripts: patterns((pattern) => ({ _tag: 'Script', pattern })),
  scriptSrc: patterns((pattern) => ({ _tag: 'ScriptSrc', pattern })),
  xhr: patterns((pattern) => ({ _tag: 'Xhr', pattern })),
  certIssuer: PatternString.pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((pattern) => [
        { _tag: 'CertIssuer', pattern },
      ]),
      encode: SchemaGetter.forbiddenEncoding,
    })
  ),
  headers: keyedPatterns((name, pattern) => ({
    _tag: 'Header',
    name: name.toLowerCase(),
    pattern,
  })),
  cookies: keyedPatterns((name, pattern) => ({
    _tag: 'Cookie',
    name: name.toLowerCase(),
    pattern,
  })),
  meta: keyedPatterns((name, pattern) => ({
    _tag: 'Meta',
    name: name.toLowerCase(),
    pattern,
  })),
  js: keyedPatterns((property, pattern) => ({
    _tag: 'Js',
    property,
    pattern,
  })),
  probe: keyedPatterns((path, pattern) => ({
    _tag: 'Probe',
    path,
    pattern,
  })),
  dns: Schema.Record(
    Rule.DnsRecordType,
    Schema.optionalKey(Schema.Array(PatternString))
  ).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((records) =>
        Rule.DnsRecordType.literals.flatMap((type) =>
          (records[type] ?? []).map((pattern) => ({
            _tag: 'Dns',
            type,
            pattern,
          }))
        )
      ),
      encode: SchemaGetter.forbiddenEncoding,
    })
  ),
  dom: Dom,
}

const Fingerprint = Schema.Struct({
  ...Struct.pick(Technology.Technology.fields, [
    'description',
    'website',
    'icon',
    'cpe',
    'saas',
    'oss',
    'categories',
  ]),
  pricing: Schema.Array(Technology.Pricing).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  implies: Schema.Array(
    TaggedString.pipe(
      Schema.decodeTo(
        Technology.Implication.pipe(Schema.encodeKeys({ name: 'value' }))
      )
    )
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  excludes: Schema.Array(TechnologyName).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  requires: Schema.Array(TechnologyName).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  requiresCategory: Schema.Array(Schema.Int).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  ...Struct.map(sources, Schema.optionalKey),
}).pipe(Schema.encodeKeys({ categories: 'cats' }))

export const Technologies = Schema.Record(Schema.String, Fingerprint).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Schema.String, Technology.Technology), {
    decode: SchemaGetter.transform(
      (fingerprints) =>
        new Map(
          Object.entries(fingerprints).map(
            ([name, { requires, requiresCategory, ...fingerprint }]) => [
              name,
              {
                name,
                ...Struct.omit(fingerprint, Struct.keys(sources)),
                rules: Struct.keys(sources).flatMap(
                  (key) => fingerprint[key] ?? []
                ),
                requires: [
                  ...requires.map((name) => ({
                    _tag: 'Technology' as const,
                    name,
                  })),
                  ...requiresCategory.map((id) => ({
                    _tag: 'Category' as const,
                    id,
                  })),
                ],
              },
            ]
          )
        )
    ),
    encode: SchemaGetter.forbiddenEncoding,
  })
)

export const Categories = Schema.Record(
  Schema.String,
  Schema.Struct(Struct.omit(Category.Category.fields, ['id']))
).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Schema.Int, Category.Category), {
    decode: SchemaGetter.transform(
      (categories) =>
        new Map(
          Object.entries(categories).map(([key, category]) => {
            const id = Number(key)
            return [id, { id, ...category }]
          })
        )
    ),
    encode: SchemaGetter.forbiddenEncoding,
  })
)

export const Groups = Schema.Record(
  Schema.String,
  Schema.Struct(Struct.omit(Group.Group.fields, ['id']))
).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Schema.Int, Group.Group), {
    decode: SchemaGetter.transform(
      (groups) =>
        new Map(
          Object.entries(groups).map(([key, group]) => {
            const id = Number(key)
            return [id, { id, ...group }]
          })
        )
    ),
    encode: SchemaGetter.forbiddenEncoding,
  })
)
