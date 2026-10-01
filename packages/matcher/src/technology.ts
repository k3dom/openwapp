import { Array, Effect, Schema, SchemaGetter, Struct } from 'effect'

import * as Pattern from '#/pattern.ts'
import * as Rule from '#/rule.ts'

export const Pricing = Schema.Literals([
  'low',
  'mid',
  'high',
  'freemium',
  'onetime',
  'recurring',
  'poa',
  'payg',
])
export type Pricing = typeof Pricing.Type

export class Implication extends Schema.Class<Implication>(
  '@openwapp/matcher/technology/Implication'
)({
  name: Schema.String,
  confidence: Pattern.Confidence,
  version: Pattern.Version,
}) {}

export const Prerequisite = Schema.TaggedUnion({
  Technology: { name: Schema.String },
  Category: { id: Schema.Int },
})
export type Prerequisite = typeof Prerequisite.Type

export class Technology extends Schema.Class<Technology>(
  '@openwapp/matcher/technology/Technology'
)({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  website: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  cpe: Schema.optionalKey(Schema.String),
  saas: Schema.optionalKey(Schema.Boolean),
  oss: Schema.optionalKey(Schema.Boolean),
  pricing: Schema.Array(Pricing),
  categories: Schema.NonEmptyArray(Schema.Int),
  rules: Schema.Array(Rule.Rule),
  implies: Schema.Array(Implication),
  excludes: Schema.Array(Schema.String),
  requires: Schema.Array(Prerequisite),
}) {}

const Rules = Schema.Array(Rule.Rule)

const patterns = (toRule: (pattern: Pattern.Pattern) => Rule.Rule) =>
  Schema.Array(Pattern.FromString).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((patterns) => patterns.map(toRule)),
      encode: SchemaGetter.forbiddenEncoding,
    })
  )

const keyedPatterns = (
  toRule: (key: string, pattern: Pattern.Pattern) => Rule.Rule
) =>
  Schema.Record(Schema.String, Pattern.FromString).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((patterns) =>
        Object.entries(patterns).map(([key, pattern]) => toRule(key, pattern))
      ),
      encode: SchemaGetter.forbiddenEncoding,
    })
  )

const TechnologyName = Pattern.TaggedString.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform(({ value }) => value),
    encode: SchemaGetter.forbiddenEncoding,
  })
)

const Selectors = Schema.Array(Pattern.TaggedString).pipe(
  Schema.decodeTo(Rules, {
    decode: SchemaGetter.transform((selectors) =>
      selectors.map(({ value, confidence, version }): Rule.Rule => ({
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
        Pattern.TaggedString.check(
          Schema.makeFilter(
            ({ value }) => value === '' || `Expected only tags, got "${value}"`
          )
        )
      ),
      text: Schema.optionalKey(Pattern.FromString),
      attributes: Schema.optionalKey(
        Schema.Record(Schema.String, Pattern.FromString)
      ),
      properties: Schema.optionalKey(
        Schema.Record(Schema.String, Pattern.FromString)
      ),
    })
  ).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((elements) =>
        Object.entries(elements).flatMap(
          ([
            selector,
            { exists, text, attributes = {}, properties = {} },
          ]): ReadonlyArray<Rule.Rule> => [
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
  certIssuer: Pattern.FromString.pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((pattern) => [
        { _tag: 'CertIssuer' as const, pattern },
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
    Schema.optionalKey(Schema.Array(Pattern.FromString))
  ).pipe(
    Schema.decodeTo(Rules, {
      decode: SchemaGetter.transform((records) =>
        Rule.DnsRecordType.literals.flatMap((type) =>
          (records[type] ?? []).map((pattern) => ({
            _tag: 'Dns' as const,
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
  ...Struct.pick(Technology.fields, [
    'description',
    'website',
    'icon',
    'cpe',
    'saas',
    'oss',
    'categories',
  ]),
  pricing: Schema.Array(Pricing).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([]))
  ),
  implies: Schema.Array(
    Pattern.TaggedString.pipe(
      Schema.decodeTo(Implication.pipe(Schema.encodeKeys({ name: 'value' })))
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

export const FromJson = Schema.Record(Schema.String, Fingerprint).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Schema.String, Technology), {
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
