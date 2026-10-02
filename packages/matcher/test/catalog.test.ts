import { describe, expect, it } from '@effect/vitest'
import fingerprints from '@openwapp/fingerprints'
import { Effect } from 'effect'

import * as Catalog from '#/catalog.ts'
import * as Category from '#/category.ts'
import * as Group from '#/group.ts'
import * as Technology from '#/technology.ts'

const withExample = (technology: object) => ({
  technologies: {
    Example: { cats: [1], website: 'https://example.com', ...technology },
    Other: { cats: [1], website: 'https://example.org' },
  },
  categories: { 1: { name: 'CMS', priority: 1, groups: [1] } },
  groups: { 1: { name: 'Content' } },
})

describe('Catalog.decode', () => {
  it.effect('decodes the upstream fingerprints', () =>
    Effect.gen(function* () {
      const { technologies, categories, groups } = fingerprints
      const catalog = yield* Catalog.decode(fingerprints)

      expect(catalog).toBeInstanceOf(Catalog.Catalog)
      expect([...catalog.technologies.keys()]).toEqual(
        Object.keys(technologies)
      )
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
  )

  it.effect('accepts references to known entries', () =>
    Effect.gen(function* () {
      const catalog = yield* Catalog.decode(
        withExample({
          implies: ['Other'],
          excludes: ['Other'],
          requires: ['Other'],
          requiresCategory: [1],
        })
      )
      expect(catalog.technologies.get('Example')?.requires).toEqual([
        { _tag: 'Technology', name: 'Other' },
        { _tag: 'Category', id: 1 },
      ])
    })
  )

  it.effect.each<[string, unknown, string | RegExp]>([
    ['an invalid fingerprint', withExample({ cats: [] }), /cats/],
    ['an unknown field', { ...withExample({}), extra: {} }, /extra/],
    [
      'an unknown category',
      withExample({ cats: [1, 2] }),
      'Unknown category 2\n  at ["technologies"]["Example"]["cats"][1]',
    ],
    [
      'an unknown implied technology',
      withExample({ implies: ['Other', 'Missing\\;confidence:50'] }),
      'Unknown technology "Missing"\n  at ["technologies"]["Example"]["implies"][1]',
    ],
    [
      'an unknown excluded technology',
      withExample({ excludes: ['Other', 'Missing'] }),
      'Unknown technology "Missing"\n  at ["technologies"]["Example"]["excludes"][1]',
    ],
    [
      'an unknown required technology',
      withExample({
        requires: ['Other', 'Missing'],
        requiresCategory: [1],
      }),
      'Unknown technology "Missing"\n  at ["technologies"]["Example"]["requires"][1]',
    ],
    [
      'an unknown required category',
      withExample({ requires: ['Other'], requiresCategory: [1, 2] }),
      'Unknown category 2\n  at ["technologies"]["Example"]["requiresCategory"][1]',
    ],
    [
      'an unknown group',
      {
        ...withExample({}),
        groups: { 1: { name: 'Content' }, 2: { name: 'Other' } },
        categories: { 1: { name: 'CMS', priority: 1, groups: [2, 3] } },
      },
      'Unknown group 3\n  at ["categories"]["1"]["groups"][1]',
    ],
  ])('rejects %s', ([, raw, message]) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(Catalog.decode(raw))
      expect(error).toBeInstanceOf(Catalog.CatalogError)
      expect(error.message).toMatch(message)
    })
  )

  it.effect('reports every invalid fingerprint at once', () =>
    Effect.gen(function* () {
      const raw = withExample({ cats: [], implies: ['Missing'] })
      const error = yield* Effect.flip(
        Catalog.decode({
          ...raw,
          technologies: { ...raw.technologies, Other: { cats: [1] } },
        })
      )
      expect(error.message).toMatch(/\["Example"\]\["cats"\]/)
      expect(error.message).toMatch(/\["Other"\]\["website"\]/)
      expect(error.message).not.toMatch(/Unknown technology/)
    })
  )

  it.effect('reports every unknown reference at once', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Catalog.decode(withExample({ cats: [2], implies: ['Missing'] }))
      )
      expect(error.message).toMatch(/Unknown category 2/)
      expect(error.message).toMatch(/Unknown technology "Missing"/)
    })
  )
})

describe('Catalog.decodeSync', () => {
  it('returns the catalog', () => {
    const catalog = Catalog.decodeSync(withExample({ implies: ['Other'] }))
    expect(catalog).toBeInstanceOf(Catalog.Catalog)
    expect([...catalog.technologies.keys()]).toEqual(['Example', 'Other'])
  })

  it('throws a catalog error', () => {
    const decode = () => Catalog.decodeSync(withExample({ cats: [2] }))
    expect(decode).toThrow(Catalog.CatalogError)
    expect(decode).toThrow(/Unknown category 2/)
  })
})
