import {
  Effect,
  Schema,
  SchemaGetter,
  SchemaIssue,
  SchemaTransformation,
} from 'effect'

export const Confidence = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 100 })
)

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

export const Version = Schema.Array(VersionPart)
export type Version = typeof Version.Type

export class Pattern extends Schema.Class<Pattern>(
  '@openwapp/matcher/pattern/Pattern'
)({
  regex: Schema.RegExp,
  confidence: Confidence,
  version: Version,
}) {}

export const TaggedString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Struct({
      value: Schema.String,
      confidence: Schema.String.check(Schema.isPattern(/^\d+$/)).pipe(
        Schema.decodeTo(Confidence, SchemaTransformation.numberFromString)
      ),
      version: Schema.String.pipe(
        Schema.decodeTo(Version, {
          decode: SchemaGetter.transform((template) => {
            const [, head = template, group, present = '', absent = ''] =
              /^(.*?)\\(\d)\?([^:]*):(.*)$/s.exec(template) ?? []
            const parts = head
              .split(/\\(\d)/)
              .flatMap((text, index): ReadonlyArray<VersionPart> => {
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

export const FromString = TaggedString.pipe(
  Schema.decodeTo(Pattern, {
    decode: SchemaGetter.transformEffect(
      ({ value, confidence, version }, options) =>
        Effect.try({
          try: () => ({
            // Unbounded quantifiers are capped at 250 repetitions so a pattern
            // cannot backtrack across a whole page.
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
