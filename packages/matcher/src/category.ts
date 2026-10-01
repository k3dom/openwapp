import { Schema, SchemaGetter } from 'effect'

export class Category extends Schema.Class<Category>(
  '@openwapp/matcher/category/Category'
)({
  id: Schema.Int,
  name: Schema.String,
  priority: Schema.Int,
  groups: Schema.Array(Schema.Int),
}) {}

export const FromJson = Schema.Record(
  Schema.String,
  Schema.Struct({
    name: Schema.String,
    priority: Schema.Int,
    groups: Schema.Array(Schema.Int),
  })
).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Schema.Int, Category), {
    decode: SchemaGetter.transform(
      (categories) =>
        new Map(
          Object.entries(categories).map(([key, category]) => {
            const id = Number(key)
            return [id, { id, ...category }]
          })
        )
    ),
    encode: SchemaGetter.forbiddenEncoding,
  })
)
