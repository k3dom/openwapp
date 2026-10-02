/**
 * Every fingerprint in one object, shaped as the input of `Catalog.decode`
 * from `@openwapp/matcher`. The technologies of all `technologies/*.json`
 * files are merged into a single record.
 *
 * @example
 * ```ts
 * import { Catalog } from '@openwapp/matcher'
 * import fingerprints from '@openwapp/fingerprints'
 *
 * const catalog = Catalog.decodeSync(fingerprints)
 * ```
 */
declare const fingerprints: {
  readonly technologies: Readonly<Record<string, unknown>>
  readonly categories: Readonly<Record<string, unknown>>
  readonly groups: Readonly<Record<string, unknown>>
}

export default fingerprints
