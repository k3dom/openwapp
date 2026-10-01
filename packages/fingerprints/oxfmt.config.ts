import base from '@openwapp/oxfmt/base'
import { defineConfig } from 'oxfmt'

export default defineConfig({
  ...base,
  ignorePatterns: [...base.ignorePatterns, 'data'],
})
