import { Schema } from 'effect'

import * as Pattern from '#/pattern.ts'

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

const Name = Schema.String.check(Schema.isLowercased())

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
  Header: { name: Name, pattern: Pattern.Pattern },
  Cookie: { name: Name, pattern: Pattern.Pattern },
  Meta: { name: Name, pattern: Pattern.Pattern },
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
