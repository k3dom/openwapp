import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'

import * as Catalog from '#/catalog.ts'
import * as Category from '#/category.ts'
import * as Group from '#/group.ts'

const resolve = createRequire(import.meta.url).resolve
const read = (path: string): unknown =>
  JSON.parse(readFileSync(resolve(`@openwapp/fingerprints/${path}`), 'utf8'))

describe('Catalog.FromJson', () => {
  it('decodes the upstream fingerprints', () => {
    const directory = dirname(
      resolve('@openwapp/fingerprints/technologies/a.json')
    )
    const catalog = Schema.decodeUnknownSync(Catalog.FromJson)(
      {
        technologies: Object.assign(
          {},
          ...readdirSync(directory).map((file) =>
            read(join('technologies', file))
          )
        ),
        categories: read('categories.json'),
        groups: read('groups.json'),
      },
      { onExcessProperty: 'error' }
    )

    expect(catalog).toBeInstanceOf(Catalog.Catalog)
    expect(catalog.technologies.get('WordPress')?.categories).toEqual([1, 11])
    expect(catalog.categories.get(1)).toBeInstanceOf(Category.Category)
    expect(catalog.categories.get(1)).toEqual({
      id: 1,
      name: 'CMS',
      priority: 1,
      groups: [3],
    })
    expect(catalog.groups.get(3)).toBeInstanceOf(Group.Group)
    expect(catalog.groups.get(3)).toEqual({ id: 3, name: 'Content' })
  })
})
