import { Schema } from 'effect'

import * as Pattern from '#/pattern.ts'
import * as Rule from '#/rule.ts'

/**
 * The pricing tiers and models a technology can list.
 */
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

/**
 * A technology that is detected along with the one implying it.
 */
export class Implication extends Schema.Class<Implication>(
  '@openwapp/matcher/technology/Implication'
)({
  /** Name of the implied technology. */
  name: Schema.String,
  /** The highest confidence the implied technology gets. */
  confidence: Pattern.Confidence,
  /** Version the implied technology gets, without any captures. */
  version: Pattern.Version,
}) {}

/**
 * What must be detected before the rules of a technology run, either another
 * `Technology` by name or any technology of a `Category` by id.
 */
export const Prerequisite = Schema.TaggedUnion({
  Technology: { name: Schema.String },
  Category: { id: Schema.Int },
})
export type Prerequisite = typeof Prerequisite.Type

/**
 * A technology, its rules and its relations to other technologies.
 */
export class Technology extends Schema.Class<Technology>(
  '@openwapp/matcher/technology/Technology'
)({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  website: Schema.String,
  /** File name of the icon in the upstream repository. */
  icon: Schema.optionalKey(Schema.String),
  /** [CPE 2.3](https://nvd.nist.gov/products/cpe) name of the technology. */
  cpe: Schema.optionalKey(Schema.String),
  /** Whether it is offered as software as a service. */
  saas: Schema.optionalKey(Schema.Boolean),
  /** Whether it is open source. */
  oss: Schema.optionalKey(Schema.Boolean),
  pricing: Schema.Array(Pricing),
  /** Ids of its categories. */
  categories: Schema.NonEmptyArray(Schema.Int),
  /**
   * Any matching rule detects the technology, except rules with a confidence
   * of 0, which only read a version.
   */
  rules: Schema.Array(Rule.Rule),
  /** Technologies detected along with this one. */
  implies: Schema.Array(Implication),
  /** Names of technologies this one rules out. */
  excludes: Schema.Array(Schema.String),
  /** Prerequisites, any of which lets the rules run. Empty means always. */
  requires: Schema.Array(Prerequisite),
}) {}
