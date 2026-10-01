import { Schema, SchemaGetter } from 'effect'

export class Group extends Schema.Class<Group>('@openwapp/matcher/group/Group')(
  {
    id: Schema.Int,
    name: Schema.String,
  }
) {}

export const FromJson = Schema.Record(
  Schema.String,
  Schema.Struct({ name: Schema.String })
).pipe(
  Schema.decodeTo(Schema.ReadonlyMap(Schema.Int, Group), {
    decode: SchemaGetter.transform(
      (groups) =>
        new Map(
          Object.entries(groups).map(([key, group]) => {
            const id = Number(key)
            return [id, { id, ...group }]
          })
        )
    ),
    encode: SchemaGetter.forbiddenEncoding,
  })
)
