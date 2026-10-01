import { Schema } from 'effect'

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
}).pipe(Schema.decodeTo(Catalog))
