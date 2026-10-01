import { Schema } from 'effect'

import * as Catalog from '#/catalog.ts'
import * as Observation from '#/observation.ts'
import * as Pattern from '#/pattern.ts'
import * as Rule from '#/rule.ts'
import * as Technology from '#/technology.ts'

export class Detection extends Schema.Class<Detection>(
  '@openwapp/matcher/matcher/Detection'
)({
  technology: Technology.Technology,
  confidence: Pattern.Confidence,
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
  version
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

export const match = (
  catalog: Catalog.Catalog,
  observation: Observation.Observation
): ReadonlyArray<Detection> => {
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
    Cookie: ({ name, pattern }) =>
      execute(pattern, observation.cookie.get(name)),
    Meta: ({ name, pattern }) => execute(pattern, observation.meta.get(name)),
    Js: ({ property, pattern }) =>
      execute(pattern, observation.js.get(property)),
    Dns: ({ type, pattern }) => execute(pattern, observation.dns.get(type)),
    Probe: ({ path, pattern }) => execute(pattern, observation.probe.get(path)),
    DomExists: ({ selector, confidence, version }) => ({
      confidence,
      version,
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

    const present = [...evidence.values()].filter(
      ({ confidence }) => confidence > 0
    )
    const excluded = new Set(
      present.flatMap(({ technology, confidence }) =>
        technology.excludes.filter((name) => {
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
