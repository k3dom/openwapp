import { Schema } from 'effect'

/**
 * A group of categories, such as Marketing or Security.
 */
export class Group extends Schema.Class<Group>('@openwapp/matcher/group/Group')(
  {
    id: Schema.Int,
    name: Schema.String,
  }
) {}
