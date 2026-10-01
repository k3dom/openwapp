import { defineConfig } from 'vitest/config'

/** @import { UserConfig } from 'vitest/config' */

/** @type {UserConfig} */
const config = defineConfig({
  test: {
    coverage: {
      enabled: true,
      include: ['src/**/*.ts'],
    },
  },
})

export default config
