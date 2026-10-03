import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { test } from 'node:test'

import fingerprints from '@openwapp/fingerprints'
import fingerprintsUpstream from '@openwapp/fingerprints/upstream.json' with { type: 'json' }

import upstream from '../data/upstream.json' with { type: 'json' }

test('the icons come from the upstream commit of the fingerprints', () => {
  assert.equal(upstream.commit, fingerprintsUpstream.commit)
})

test('every icon a technology names is shipped', () => {
  const icons = new Set(readdirSync(new URL('../data/', import.meta.url)))
  const named = new Set(
    Object.values(fingerprints.technologies).map(
      (technology) => technology.icon
    )
  )
  const missing = [...named].filter(
    (icon) => icon !== undefined && !icons.has(icon)
  )
  assert.deepEqual(missing, [])
  assert.ok(icons.has('default.svg'))
})
