import { Effect, Schema } from 'effect'

import * as Rule from '#/rule.ts'

const Values = Schema.Array(Schema.String).pipe(
  Schema.withConstructorDefault(Effect.succeed([]))
)

const PresentValues = Schema.NonEmptyArray(Schema.String)

const ValuesBy = <Key extends Schema.Constraint>(key: Key) =>
  Schema.ReadonlyMap(key, PresentValues).pipe(
    Schema.withConstructorDefault(Effect.succeed(new Map()))
  )

const ValuesBySelectorAndName = Schema.ReadonlyMap(
  Schema.String,
  Schema.ReadonlyMap(Schema.String, PresentValues)
).pipe(Schema.withConstructorDefault(Effect.succeed(new Map())))

/**
 * What was observed on a site, with one field per kind of rule. Every field
 * defaults to empty, so set only what was gathered. `Requirements.fromCatalog`
 * lists what a catalog can make use of.
 *
 * Maps hold every value found for a key and leave out keys without values.
 *
 * @example
 * ```ts
 * import { Observation } from '@openwapp/matcher'
 *
 * const observation = new Observation.Observation({
 *   url: ['https://example.com/'],
 *   header: new Map([['x-powered-by', ['PHP/8.3.0']]]),
 *   domExists: new Set(['#wpadminbar']),
 * })
 * ```
 */
export class Observation extends Schema.Class<Observation>(
  '@openwapp/matcher/observation/Observation'
)({
  /** Urls of the page. */
  url: Values,
  /** Html of the page. */
  html: Values,
  /** Visible text of the page. */
  text: Values,
  /** Style sheets of the page. */
  css: Values,
  /** Contents of `/robots.txt`. */
  robots: Values,
  /** Contents of the scripts of the page. */
  script: Values,
  /** Urls of the scripts the page loads. */
  scriptSrc: Values,
  /** Hostnames of the requests the page sends while running. */
  xhr: Values,
  /** Issuer of the TLS certificate of the site. */
  certIssuer: Values,
  /** Response header values by lowercase name. */
  header: ValuesBy(Rule.LowercaseName),
  /** Cookie values by lowercase name. */
  cookie: ValuesBy(Rule.LowercaseName),
  /** Contents of meta tags by lowercase `name` or `property`. */
  meta: ValuesBy(Rule.LowercaseName),
  /** Values of JavaScript globals by property path, such as `jQuery.fn.jquery`. */
  js: ValuesBy(Schema.String),
  /** DNS records by type. */
  dns: ValuesBy(Rule.DnsRecordType),
  /** Response bodies by path, for the paths the catalog probes. */
  probe: ValuesBy(Schema.String),
  /** CSS selectors that match at least one element. */
  domExists: Schema.ReadonlySet(Schema.String).pipe(
    Schema.withConstructorDefault(Effect.succeed(new Set()))
  ),
  /** Text of the matching elements by CSS selector. */
  domText: ValuesBy(Schema.String),
  /** Attribute values of the matching elements by CSS selector and name. */
  domAttribute: ValuesBySelectorAndName,
  /** DOM property values of the matching elements by CSS selector and name. */
  domProperty: ValuesBySelectorAndName,
}) {}
