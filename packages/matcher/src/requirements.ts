import { Schema } from 'effect'

import * as Catalog from '#/catalog.ts'
import * as Rule from '#/rule.ts'

const NamesBySelector = Schema.ReadonlyMap(
  Schema.String,
  Schema.ReadonlySet(Schema.String)
)

/**
 * What a catalog can make use of, so a collector gathers only that. Each field
 * matches the `Observation` field of the same name. A boolean says whether the
 * field is needed at all, and a set or map lists the names, types, paths or
 * selectors needed. Cookie names can hold a `*`, which stands for any run of
 * characters.
 */
export class Requirements extends Schema.Class<Requirements>(
  '@openwapp/matcher/requirements/Requirements'
)({
  url: Schema.Boolean,
  html: Schema.Boolean,
  text: Schema.Boolean,
  css: Schema.Boolean,
  robots: Schema.Boolean,
  script: Schema.Boolean,
  scriptSrc: Schema.Boolean,
  xhr: Schema.Boolean,
  certIssuer: Schema.Boolean,
  header: Schema.ReadonlySet(Rule.LowercaseName),
  cookie: Schema.ReadonlySet(Rule.LowercaseName),
  meta: Schema.ReadonlySet(Rule.LowercaseName),
  js: Schema.ReadonlySet(Schema.String),
  dns: Schema.ReadonlySet(Rule.DnsRecordType),
  probe: Schema.ReadonlySet(Schema.String),
  domExists: Schema.ReadonlySet(Schema.String),
  domText: Schema.ReadonlySet(Schema.String),
  domAttribute: NamesBySelector,
  domProperty: NamesBySelector,
}) {}

/**
 * Lists what the rules of a catalog look at.
 *
 * @example
 * ```ts
 * import { Requirements } from '@openwapp/matcher'
 *
 * const requirements = Requirements.fromCatalog(catalog)
 * const withoutDns = new Requirements.Requirements({
 *   ...requirements,
 *   dns: new Set(),
 *   certIssuer: false,
 * })
 * ```
 */
export const fromCatalog = (catalog: Catalog.Catalog) => {
  const rules = [...catalog.technologies.values()].flatMap(({ rules }) => rules)
  const of = <const Tag extends Rule.Rule['_tag']>(tag: Tag) =>
    rules.filter(Rule.Rule.isAnyOf([tag]))
  return new Requirements({
    url: of('Url').length > 0,
    html: of('Html').length > 0,
    text: of('Text').length > 0,
    css: of('Css').length > 0,
    robots: of('Robots').length > 0,
    script: of('Script').length > 0,
    scriptSrc: of('ScriptSrc').length > 0,
    xhr: of('Xhr').length > 0,
    certIssuer: of('CertIssuer').length > 0,
    header: new Set(of('Header').map(({ name }) => name)),
    cookie: new Set(of('Cookie').map(({ name }) => name)),
    meta: new Set(of('Meta').map(({ name }) => name)),
    js: new Set(of('Js').map(({ property }) => property)),
    dns: new Set(of('Dns').map(({ type }) => type)),
    probe: new Set(of('Probe').map(({ path }) => path)),
    domExists: new Set(of('DomExists').map(({ selector }) => selector)),
    domText: new Set(of('DomText').map(({ selector }) => selector)),
    domAttribute: new Map(
      [...Map.groupBy(of('DomAttribute'), ({ selector }) => selector)].map(
        ([selector, rules]) => [
          selector,
          new Set(rules.map(({ attribute }) => attribute)),
        ]
      )
    ),
    domProperty: new Map(
      [...Map.groupBy(of('DomProperty'), ({ selector }) => selector)].map(
        ([selector, rules]) => [
          selector,
          new Set(rules.map(({ property }) => property)),
        ]
      )
    ),
  })
}
