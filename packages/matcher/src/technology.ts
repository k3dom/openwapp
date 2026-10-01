import { Schema, SchemaGetter } from 'effect'

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
  Schema.String.pipe(
    Schema.decodeTo(Selectors, {
      decode: SchemaGetter.transform((selector) => [selector]),
      encode: SchemaGetter.forbiddenEncoding,
    })
  ),
  Selectors,
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
          ]): Array<Rule.Rule> => [
            ...(exists === undefined
              ? []
              : [
                  {
                    _tag: 'DomExists' as const,
                    selector,
                    confidence: exists.confidence,
                    version: exists.version,
                  },
                ]),
            ...(text === undefined
              ? []
              : [{ _tag: 'DomText' as const, selector, pattern: text }]),
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

const Fingerprint = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  website: Schema.String,
  icon: Schema.optionalKey(Schema.String),
  cpe: Schema.optionalKey(Schema.String),
  saas: Schema.optionalKey(Schema.Boolean),
  oss: Schema.optionalKey(Schema.Boolean),
  pricing: Schema.optionalKey(Schema.Array(Pricing)),
  cats: Schema.NonEmptyArray(Schema.Int),
  implies: Schema.optionalKey(
    Schema.Array(
      Pattern.TaggedString.pipe(
        Schema.decodeTo(Implication, {
          decode: SchemaGetter.transform(({ value, confidence, version }) => ({
            name: value,
            confidence,
            version,
          })),
          encode: SchemaGetter.forbiddenEncoding,
        })
      )
    )
  ),
  excludes: Schema.optionalKey(Schema.Array(TechnologyName)),
  requires: Schema.optionalKey(Schema.Array(TechnologyName)),
  requiresCategory: Schema.optionalKey(Schema.Array(Schema.Int)),
  url: Schema.optionalKey(patterns((pattern) => ({ _tag: 'Url', pattern }))),
  html: Schema.optionalKey(patterns((pattern) => ({ _tag: 'Html', pattern }))),
  text: Schema.optionalKey(patterns((pattern) => ({ _tag: 'Text', pattern }))),
  css: Schema.optionalKey(patterns((pattern) => ({ _tag: 'Css', pattern }))),
  robots: Schema.optionalKey(
    patterns((pattern) => ({ _tag: 'Robots', pattern }))
  ),
  scripts: Schema.optionalKey(
    patterns((pattern) => ({ _tag: 'Script', pattern }))
  ),
  scriptSrc: Schema.optionalKey(
    patterns((pattern) => ({ _tag: 'ScriptSrc', pattern }))
  ),
  xhr: Schema.optionalKey(patterns((pattern) => ({ _tag: 'Xhr', pattern }))),
  certIssuer: Schema.optionalKey(
    Pattern.FromString.pipe(
      Schema.decodeTo(Rules, {
        decode: SchemaGetter.transform((pattern) => [
          { _tag: 'CertIssuer' as const, pattern },
        ]),
        encode: SchemaGetter.forbiddenEncoding,
      })
    )
  ),
  headers: Schema.optionalKey(
    keyedPatterns((name, pattern) => ({
      _tag: 'Header',
      name: name.toLowerCase(),
      pattern,
    }))
  ),
  cookies: Schema.optionalKey(
    keyedPatterns((name, pattern) => ({
      _tag: 'Cookie',
      name: name.toLowerCase(),
      pattern,
    }))
  ),
  meta: Schema.optionalKey(
    keyedPatterns((name, pattern) => ({
      _tag: 'Meta',
      name: name.toLowerCase(),
      pattern,
    }))
  ),
  js: Schema.optionalKey(
    keyedPatterns((property, pattern) => ({ _tag: 'Js', property, pattern }))
  ),
  probe: Schema.optionalKey(
    keyedPatterns((path, pattern) => ({ _tag: 'Probe', path, pattern }))
  ),
  dns: Schema.optionalKey(
    Schema.Record(
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
    )
  ),
  dom: Schema.optionalKey(Dom),
})

export const FromJson = Schema.Record(Schema.String, Fingerprint).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Schema.String, Technology), {
    decode: SchemaGetter.transform(
      (fingerprints) =>
        new Map(
          Object.entries(fingerprints).map(
            ([
              name,
              {
                pricing = [],
                cats,
                implies = [],
                excludes = [],
                requires = [],
                requiresCategory = [],
                url = [],
                html = [],
                text = [],
                css = [],
                robots = [],
                scripts = [],
                scriptSrc = [],
                xhr = [],
                certIssuer = [],
                headers = [],
                cookies = [],
                meta = [],
                js = [],
                probe = [],
                dns = [],
                dom = [],
                ...metadata
              },
            ]) => [
              name,
              {
                name,
                ...metadata,
                pricing,
                categories: cats,
                rules: [
                  ...url,
                  ...html,
                  ...text,
                  ...css,
                  ...robots,
                  ...scripts,
                  ...scriptSrc,
                  ...xhr,
                  ...certIssuer,
                  ...headers,
                  ...cookies,
                  ...meta,
                  ...js,
                  ...probe,
                  ...dns,
                  ...dom,
                ],
                implies,
                excludes,
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
