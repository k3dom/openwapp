import { Schema } from 'effect'

import * as Catalog from '#/catalog.ts'
import * as Observation from '#/observation.ts'
import * as Pattern from '#/pattern.ts'
import * as Rule from '#/rule.ts'
import * as Technology from '#/technology.ts'

/**
 * A technology that `match` found in an observation.
 */
export class Detection extends Schema.Class<Detection>(
  '@openwapp/matcher/matcher/Detection'
)({
  technology: Technology.Technology,
  /**
   * How sure the match is, from 0 to 100. The confidences of the matching
   * rules add up, and an implication passes on at most the confidence of the
   * technology implying it.
   */
  confidence: Pattern.Confidence,
  /**
   * The longest version that the rules found or an implication set. Values
   * that look like hashes or build numbers are skipped. Left out when no
   * version was found.
   */
  version: Schema.optionalKey(Schema.String),
}) {}

interface Evidence {
  readonly technology: Technology.Technology
  readonly confidence: number
  readonly versions: ReadonlyArray<string>
}

const resolveVersion = (
  version: Pattern.Version,
  groups: ReadonlyArray<string | undefined>
) =>
  // Captures longer than 10 characters are usually hashes or tokens, which
  // would leave a version made of the surrounding text alone.
  version
    .filter(Pattern.VersionPart.guards.Capture)
    .some(({ group }) => (groups[group]?.length ?? 0) > 10)
    ? ''
    : version
        .map((part) =>
          Pattern.VersionPart.match(part, {
            Text: ({ value }) => value,
            Capture: ({ group }) => groups[group] ?? '',
            Conditional: ({ group, present, absent }) =>
              groups[group] ? present : absent,
          })
        )
        .join('')
        .trim()

/**
 * Finds the technologies of a catalog in an observation.
 *
 * Runs the rules of every technology against the observation and follows the
 * `requires`, `implies` and `excludes` relations between technologies. Returns
 * one `Detection` per technology found, in catalog order.
 *
 * @example
 * ```ts
 * import { Matcher, Observation } from '@openwapp/matcher'
 *
 * const detections = Matcher.match(
 *   catalog,
 *   new Observation.Observation({
 *     header: new Map([['x-powered-by', ['PHP/8.3.0']]]),
 *   })
 * )
 * ```
 */
export const match = (
  catalog: Catalog.Catalog,
  observation: Observation.Observation
) => {
  const execute = (
    { regex, confidence, version }: Pattern.Pattern,
    values: ReadonlyArray<string> = []
  ) => ({
    confidence,
    version,
    matches: values
      .map((value) => regex.exec(value))
      .filter((groups) => groups !== null),
  })
  const evaluate = Rule.Rule.match<{
    readonly confidence: number
    readonly version: Pattern.Version
    readonly matches: ReadonlyArray<ReadonlyArray<string | undefined>>
  }>({
    Url: ({ pattern }) => execute(pattern, observation.url),
    Html: ({ pattern }) => execute(pattern, observation.html),
    Text: ({ pattern }) => execute(pattern, observation.text),
    Css: ({ pattern }) => execute(pattern, observation.css),
    Robots: ({ pattern }) => execute(pattern, observation.robots),
    Script: ({ pattern }) => execute(pattern, observation.script),
    ScriptSrc: ({ pattern }) => execute(pattern, observation.scriptSrc),
    Xhr: ({ pattern }) => execute(pattern, observation.xhr),
    CertIssuer: ({ pattern }) => execute(pattern, observation.certIssuer),
    Header: ({ name, pattern }) =>
      execute(pattern, observation.header.get(name)),
    Cookie: ({ name, pattern }) => {
      if (!name.includes('*')) {
        return execute(pattern, observation.cookie.get(name))
      }
      const glob = new RegExp(
        `^${name.replaceAll(/[\\^$.+?()[\]{}|]/g, '\\$&').replaceAll('*', '.*')}$`,
        's'
      )
      return execute(
        pattern,
        [...observation.cookie]
          .filter(([observedName]) => glob.test(observedName))
          .flatMap(([, values]) => values)
      )
    },
    Meta: ({ name, pattern }) => execute(pattern, observation.meta.get(name)),
    Js: ({ property, pattern }) =>
      execute(pattern, observation.js.get(property)),
    Dns: ({ type, pattern }) => execute(pattern, observation.dns.get(type)),
    Probe: ({ path, pattern }) => execute(pattern, observation.probe.get(path)),
    DomExists: ({ selector, confidence, version }) => ({
      confidence,
      version,
      // A found selector counts as a single match without captures.
      matches: observation.domExists.has(selector) ? [[]] : [],
    }),
    DomText: ({ selector, pattern }) =>
      execute(pattern, observation.domText.get(selector)),
    DomAttribute: ({ selector, attribute, pattern }) =>
      execute(pattern, observation.domAttribute.get(selector)?.get(attribute)),
    DomProperty: ({ selector, property, pattern }) =>
      execute(pattern, observation.domProperty.get(selector)?.get(property)),
  })

  const evidence = new Map<string, Evidence>()
  const waiting = new Set(catalog.technologies.values())
  let detected = new Map<string, Evidence>()
  for (;;) {
    const categories = new Set(
      [...detected.values()].flatMap(({ technology }) => technology.categories)
    )
    const satisfied = Technology.Prerequisite.match({
      Technology: ({ name }) => detected.has(name),
      Category: ({ id }) => categories.has(id),
    })
    // Implied technologies run their rules as well to pick up a version. A
    // technology stays matched once its rules ran, so it can exclude what it
    // requires, as BigCommerce B2B Edition does with BigCommerce.
    const ready = [...waiting].filter(
      ({ name, requires }) =>
        requires.length === 0 || detected.has(name) || requires.some(satisfied)
    )
    if (ready.length === 0) break

    for (const technology of ready) {
      waiting.delete(technology)
      const results = technology.rules
        .map(evaluate)
        .filter(({ matches }) => matches.length > 0)
      if (results.length === 0) continue
      evidence.set(technology.name, {
        technology,
        confidence: Math.min(
          100,
          results.reduce((sum, { confidence }) => sum + confidence, 0)
        ),
        versions: results.flatMap(({ version, matches }) =>
          matches.map((groups) => resolveVersion(version, groups))
        ),
      })
    }

    // Rules with zero confidence only extract a version, such as `_.VERSION`,
    // which Lodash and Underscore.js share.
    const present = [...evidence.values()].filter(
      ({ confidence }) => confidence > 0
    )
    const excluded = new Set(
      present.flatMap(({ technology, confidence }) =>
        technology.excludes.filter((name) => {
          // Of two technologies that exclude each other, the more confident
          // one stays.
          const other = evidence.get(name)
          return !(
            other !== undefined &&
            other.confidence > confidence &&
            other.technology.excludes.includes(technology.name)
          )
        })
      )
    )

    detected = new Map(
      present
        .filter(({ technology }) => !excluded.has(technology.name))
        .map((entry) => [entry.technology.name, entry])
    )
    // A technology is queued again whenever an implication raises its
    // confidence, so the highest one wins regardless of order.
    const queue = [...detected.values()]
    for (const { technology, confidence } of queue) {
      for (const implication of technology.implies) {
        const implied = catalog.technologies.get(implication.name)
        const current = detected.get(implication.name)
        const impliedConfidence = Math.min(confidence, implication.confidence)
        if (
          implied === undefined ||
          excluded.has(implied.name) ||
          impliedConfidence <= (current?.confidence ?? 0)
        ) {
          continue
        }
        const entry = {
          technology: implied,
          confidence: impliedConfidence,
          versions: evidence.get(implied.name)?.versions ?? [],
        }
        detected.set(implied.name, entry)
        queue.push(entry)
      }
    }
  }

  const impliedVersions = [...detected.values()].flatMap(({ technology }) =>
    technology.implies.map(({ name, version }) => ({
      name,
      version: resolveVersion(version, []),
    }))
  )
  return [...catalog.technologies.values()].flatMap((technology) => {
    const entry = detected.get(technology.name)
    if (entry === undefined) return []
    const version = [
      ...entry.versions,
      ...impliedVersions
        .filter(({ name }) => name === technology.name)
        .map(({ version }) => version),
    ]
      // Long versions and numbers from 10000 up are usually hashes, build
      // numbers or timestamps rather than versions.
      .filter(
        (version) =>
          version.length <= 15 && !(Number.parseInt(version, 10) >= 10_000)
      )
      .reduce(
        (longest, version) =>
          version.length > longest.length ? version : longest,
        ''
      )
    return [
      new Detection({
        technology,
        confidence: entry.confidence,
        ...(version === '' ? {} : { version }),
      }),
    ]
  })
}
