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

export class Observation extends Schema.Class<Observation>(
  '@openwapp/matcher/observation/Observation'
)({
  url: Values,
  html: Values,
  text: Values,
  css: Values,
  robots: Values,
  script: Values,
  scriptSrc: Values,
  xhr: Values,
  certIssuer: Values,
  header: ValuesBy(Rule.LowercaseName),
  cookie: ValuesBy(Rule.LowercaseName),
  meta: ValuesBy(Rule.LowercaseName),
  js: ValuesBy(Schema.String),
  dns: ValuesBy(Rule.DnsRecordType),
  probe: ValuesBy(Schema.String),
  domExists: Schema.ReadonlySet(Schema.String).pipe(
    Schema.withConstructorDefault(Effect.succeed(new Set()))
  ),
  domText: ValuesBy(Schema.String),
  domAttribute: ValuesBySelectorAndName,
  domProperty: ValuesBySelectorAndName,
}) {}
