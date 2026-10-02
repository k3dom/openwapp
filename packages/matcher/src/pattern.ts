import { Schema } from 'effect'

/**
 * An integer from 0 to 100.
 */
export const Confidence = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 100 })
)

/**
 * A part of a version template. `Text` is taken as is, `Capture` inserts a
 * regex group and `Conditional` inserts `present` or `absent` depending on
 * whether a group matched.
 */
export const VersionPart = Schema.TaggedUnion({
  Text: { value: Schema.String },
  Capture: { group: Schema.Int },
  Conditional: {
    group: Schema.Int,
    present: Schema.String,
    absent: Schema.String,
  },
})
export type VersionPart = typeof VersionPart.Type

/**
 * A version template, decoded from the `\1` and `\1?present:absent` syntax of
 * a `version` tag.
 */
export const Version = Schema.Array(VersionPart)
export type Version = typeof Version.Type

/**
 * A compiled pattern of a rule.
 */
export class Pattern extends Schema.Class<Pattern>(
  '@openwapp/matcher/pattern/Pattern'
)({
  /**
   * Case-insensitive, with unbounded quantifiers capped at 250 repetitions.
   */
  regex: Schema.RegExp,
  /** Confidence the pattern adds when it matches. */
  confidence: Confidence,
  /** How to build a version from the groups the regex captured. */
  version: Version,
}) {}
