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
  const test = (
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
    Url: ({ pattern }) => test(pattern, observation.url),
    Html: ({ pattern }) => test(pattern, observation.html),
    Text: ({ pattern }) => test(pattern, observation.text),
    Css: ({ pattern }) => test(pattern, observation.css),
    Robots: ({ pattern }) => test(pattern, observation.robots),
    Script: ({ pattern }) => test(pattern, observation.script),
    ScriptSrc: ({ pattern }) => test(pattern, observation.scriptSrc),
    Xhr: ({ pattern }) => test(pattern, observation.xhr),
    CertIssuer: ({ pattern }) => test(pattern, observation.certIssuer),
    Header: ({ name, pattern }) => test(pattern, observation.header.get(name)),
    Cookie: ({ name, pattern }) => test(pattern, observation.cookie.get(name)),
    Meta: ({ name, pattern }) => test(pattern, observation.meta.get(name)),
    Js: ({ property, pattern }) => test(pattern, observation.js.get(property)),
    Dns: ({ type, pattern }) => test(pattern, observation.dns.get(type)),
    Probe: ({ path, pattern }) => test(pattern, observation.probe.get(path)),
    DomExists: ({ selector, confidence, version }) => ({
      confidence,
      version,
      matches: observation.domExists.has(selector) ? [[]] : [],
    }),
    DomText: ({ selector, pattern }) =>
      test(pattern, observation.domText.get(selector)),
    DomAttribute: ({ selector, attribute, pattern }) =>
      test(pattern, observation.domAttribute.get(selector)?.get(attribute)),
    DomProperty: ({ selector, property, pattern }) =>
      test(pattern, observation.domProperty.get(selector)?.get(property)),
  })

  const evidence = new Map<string, Evidence>()
  const waiting = new Set(catalog.technologies.values())
  let detected = new Map<string, Evidence>()
  for (;;) {
    const categories = new Set(
      [...detected.values()].flatMap(({ technology }) => technology.categories)
    )
    const ready = [...waiting].filter(
      ({ requires }) =>
        requires.length === 0 ||
        requires.some((prerequisite) =>
          prerequisite._tag === 'Technology'
            ? detected.has(prerequisite.name)
            : categories.has(prerequisite.id)
        )
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

    const ranked = [...evidence.values()]
      .filter(({ confidence }) => confidence > 0)
      .toSorted((a, b) => b.confidence - a.confidence)
    const excluded = new Set<string>()
    for (const { technology } of ranked) {
      if (excluded.has(technology.name)) continue
      for (const name of technology.excludes) excluded.add(name)
    }

    detected = new Map(
      ranked
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
