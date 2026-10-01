import { readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { describe, expect, it } from '@effect/vitest'
import { Schema } from 'effect'

import * as Catalog from '#/catalog.ts'
import * as Category from '#/category.ts'
import * as Group from '#/group.ts'
import * as Technology from '#/technology.ts'

const resolve = createRequire(import.meta.url).resolve
const read = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(resolve(`@openwapp/fingerprints/${path}`), 'utf8'))

describe('Catalog.FromJson', () => {
  it('decodes the upstream fingerprints', () => {
    const technologies = Object.assign(
      {},
      ...readdirSync(
        dirname(resolve('@openwapp/fingerprints/technologies/a.json'))
      ).map((file) => read(join('technologies', file)))
    )
    const categories = read('categories.json')
    const groups = read('groups.json')

    const catalog = Schema.decodeUnknownSync(Catalog.FromJson)(
      { technologies, categories, groups },
      { onExcessProperty: 'error' }
    )

    expect(catalog).toBeInstanceOf(Catalog.Catalog)
    expect([...catalog.technologies.keys()]).toEqual(Object.keys(technologies))
    expect(catalog.categories.size).toBe(Object.keys(categories).length)
    expect(catalog.groups.size).toBe(Object.keys(groups).length)
    for (const [name, technology] of catalog.technologies) {
      expect(technology).toBeInstanceOf(Technology.Technology)
      expect(technology.name).toBe(name)
    }
    for (const [id, category] of catalog.categories) {
      expect(category).toBeInstanceOf(Category.Category)
      expect(category.id).toBe(id)
    }
    for (const [id, group] of catalog.groups) {
      expect(group).toBeInstanceOf(Group.Group)
      expect(group.id).toBe(id)
    }
  })
})
