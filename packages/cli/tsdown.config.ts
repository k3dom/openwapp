import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    bin: './src/bin.ts',
  },
  fixedExtension: false,
  publint: { level: 'error' },
  sourcemap: true,
  platform: 'node',
  dts: false,
})
