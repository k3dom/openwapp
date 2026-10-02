import { Effect, Schema } from 'effect'

import * as Category from '#/category.ts'
import * as Fingerprint from '#/fingerprint.ts'
import * as Group from '#/group.ts'
import * as Technology from '#/technology.ts'

/**
 * Technologies with their rules, the categories they belong to and the groups
 * of those categories. Build one with `decode` or `decodeSync`.
 */
export class Catalog extends Schema.Class<Catalog>(
  '@openwapp/matcher/catalog/Catalog'
)({
  /** Technologies by name, in the order of the fingerprints. */
  technologies: Schema.ReadonlyMap(Schema.String, Technology.Technology),
  /** Categories by id. */
  categories: Schema.ReadonlyMap(Schema.Int, Category.Category),
  /** Groups by id. */
  groups: Schema.ReadonlyMap(Schema.Int, Group.Group),
}) {}

const FromJson = Schema.Struct({
  technologies: Fingerprint.Technologies,
  categories: Fingerprint.Categories,
  groups: Fingerprint.Groups,
})
  .check(
    Schema.makeFilter(({ technologies, categories, groups }) =>
      [
        ...[...technologies].flatMap(([name, technology]) => [
          ...technology.categories.map((id, index) => ({
            path: ['technologies', name, 'cats', index],
            found: categories.has(id),
            issue: `Unknown category ${id}`,
          })),
          ...technology.implies.map((implication, index) => ({
            path: ['technologies', name, 'implies', index],
            found: technologies.has(implication.name),
            issue: `Unknown technology "${implication.name}"`,
          })),
          ...technology.excludes.map((excluded, index) => ({
            path: ['technologies', name, 'excludes', index],
            found: technologies.has(excluded),
            issue: `Unknown technology "${excluded}"`,
          })),
          ...technology.requires
            .filter(Technology.Prerequisite.guards.Technology)
            .map((prerequisite, index) => ({
              path: ['technologies', name, 'requires', index],
              found: technologies.has(prerequisite.name),
              issue: `Unknown technology "${prerequisite.name}"`,
            })),
          ...technology.requires
            .filter(Technology.Prerequisite.guards.Category)
            .map((prerequisite, index) => ({
              path: ['technologies', name, 'requiresCategory', index],
              found: categories.has(prerequisite.id),
              issue: `Unknown category ${prerequisite.id}`,
            })),
        ]),
        ...[...categories].flatMap(([id, category]) =>
          category.groups.map((group, index) => ({
            path: ['categories', String(id), 'groups', index],
            found: groups.has(group),
            issue: `Unknown group ${group}`,
          }))
        ),
      ].flatMap(({ path, found, issue }) => (found ? [] : [{ path, issue }]))
    )
  )
  .pipe(Schema.decodeTo(Catalog))

/**
 * The fingerprints given to `decode` are invalid. The message lists every
 * invalid fingerprint and every reference to an unknown technology, category
 * or group.
 */
export class CatalogError extends Schema.TaggedError<CatalogError>(
  '@openwapp/matcher/catalog/CatalogError'
)('CatalogError', {
  cause: Schema.instanceOf(Schema.SchemaError),
}) {
  override get message() {
    return this.cause.message
  }
}

/**
 * Decodes fingerprints in the
 * [webappanalyzer format](https://github.com/enthec/webappanalyzer#specification)
 * into a `Catalog`. The input is an object of `technologies`, `categories` and
 * `groups`, which is what `@openwapp/fingerprints` exports by default.
 *
 * Fails with a `CatalogError` when the fingerprints are invalid. Use
 * `decodeSync` to get the catalog without Effect.
 */
export const decode = (input: unknown) =>
  Schema.decodeUnknownEffect(FromJson)(input, {
    errors: 'all',
    onExcessProperty: 'error',
  }).pipe(Effect.mapError((cause) => new CatalogError({ cause })))

/**
 * Decodes fingerprints in the
 * [webappanalyzer format](https://github.com/enthec/webappanalyzer#specification)
 * into a `Catalog`, like `decode` but without Effect.
 *
 * @throws {CatalogError} When the fingerprints are invalid.
 *
 * @example
 * ```ts
 * import fingerprints from '@openwapp/fingerprints'
 * import { Catalog } from '@openwapp/matcher'
 *
 * const catalog = Catalog.decodeSync(fingerprints)
 * ```
 */
export const decodeSync = (input: unknown) => Effect.runSync(decode(input))
