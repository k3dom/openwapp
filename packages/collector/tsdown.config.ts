import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
  },
  exports: true,
  fixedExtension: false,
  publint: { level: 'error' },
  attw: { profile: 'esm-only', level: 'error' },
  sourcemap: true,
  platform: 'node',
  dts: {
    sourcemap: true,
  },
})
