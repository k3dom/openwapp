import { Schema } from 'effect'

import * as Pattern from '#/pattern.ts'

/**
 * The DNS record types rules can match.
 */
export const DnsRecordType = Schema.Literals([
  'A',
  'AAAA',
  'CAA',
  'CNAME',
  'MX',
  'NAPTR',
  'NS',
  'PTR',
  'SOA',
  'SRV',
  'TXT',
])
export type DnsRecordType = typeof DnsRecordType.Type

/**
 * A lowercase string, the form header, cookie and meta names take.
 */
export const LowercaseName = Schema.String.check(Schema.isLowercased())

/**
 * A single check of a technology, tagged by what it looks at. Each tag reads
 * the `Observation` field of the same name, such as `ScriptSrc` and
 * `scriptSrc`. Every tag but `DomExists` matches a `pattern` against it.
 */
export const Rule = Schema.TaggedUnion({
  Url: { pattern: Pattern.Pattern },
  Html: { pattern: Pattern.Pattern },
  Text: { pattern: Pattern.Pattern },
  Css: { pattern: Pattern.Pattern },
  Robots: { pattern: Pattern.Pattern },
  Script: { pattern: Pattern.Pattern },
  ScriptSrc: { pattern: Pattern.Pattern },
  Xhr: { pattern: Pattern.Pattern },
  CertIssuer: { pattern: Pattern.Pattern },
  Header: { name: LowercaseName, pattern: Pattern.Pattern },
  Cookie: { name: LowercaseName, pattern: Pattern.Pattern },
  Meta: { name: LowercaseName, pattern: Pattern.Pattern },
  Js: { property: Schema.String, pattern: Pattern.Pattern },
  Dns: { type: DnsRecordType, pattern: Pattern.Pattern },
  Probe: { path: Schema.String, pattern: Pattern.Pattern },
  DomExists: {
    selector: Schema.String,
    confidence: Pattern.Confidence,
    version: Pattern.Version,
  },
  DomText: { selector: Schema.String, pattern: Pattern.Pattern },
  DomAttribute: {
    selector: Schema.String,
    attribute: Schema.String,
    pattern: Pattern.Pattern,
  },
  DomProperty: {
    selector: Schema.String,
    property: Schema.String,
    pattern: Pattern.Pattern,
  },
})
export type Rule = typeof Rule.Type
