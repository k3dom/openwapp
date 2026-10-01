import { defineConfig } from 'oxlint'

export default defineConfig({
  ignorePatterns: ['dist', 'coverage'],
  options: {
    denyWarnings: true,
    reportUnusedDisableDirectives: 'deny',
    typeAware: true,
    typeCheck: true,
  },
})
