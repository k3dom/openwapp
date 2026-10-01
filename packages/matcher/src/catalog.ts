import { Effect, Schema } from 'effect'

import * as Category from '#/category.ts'
import * as Group from '#/group.ts'
import * as Technology from '#/technology.ts'

export class Catalog extends Schema.Class<Catalog>(
  '@openwapp/matcher/catalog/Catalog'
)({
  technologies: Schema.ReadonlyMap(Schema.String, Technology.Technology),
  categories: Schema.ReadonlyMap(Schema.Int, Category.Category),
  groups: Schema.ReadonlyMap(Schema.Int, Group.Group),
}) {}

export const FromJson = Schema.Struct({
  technologies: Technology.FromJson,
  categories: Category.FromJson,
  groups: Group.FromJson,
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
            .filter((prerequisite) => prerequisite._tag === 'Technology')
            .map((prerequisite, index) => ({
              path: ['technologies', name, 'requires', index],
              found: technologies.has(prerequisite.name),
              issue: `Unknown technology "${prerequisite.name}"`,
            })),
          ...technology.requires
            .filter((prerequisite) => prerequisite._tag === 'Category')
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

export class CatalogError extends Schema.TaggedError<CatalogError>(
  '@openwapp/matcher/catalog/CatalogError'
)('CatalogError', {
  cause: Schema.instanceOf(Schema.SchemaError),
}) {
  override get message() {
    return this.cause.message
  }
}

export const decode = (input: unknown): Effect.Effect<Catalog, CatalogError> =>
  Schema.decodeUnknownEffect(FromJson)(input, {
    errors: 'all',
    onExcessProperty: 'error',
  }).pipe(Effect.mapError((cause) => new CatalogError({ cause })))

export const decodeSync = (input: unknown): Catalog =>
  Effect.runSync(decode(input))
