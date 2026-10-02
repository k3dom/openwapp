import { Schema } from 'effect'

/**
 * A category of technologies, such as CMS or Analytics.
 */
export class Category extends Schema.Class<Category>(
  '@openwapp/matcher/category/Category'
)({
  id: Schema.Int,
  name: Schema.String,
  /** Lower numbers rank higher, such as 1 for CMS and 9 for Widgets. */
  priority: Schema.Int,
  /** Ids of the groups the category belongs to. */
  groups: Schema.Array(Schema.Int),
}) {}
