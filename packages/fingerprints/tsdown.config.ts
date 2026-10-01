import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: './src/index.ts',
  },
  exports: true,
  sourcemap: true,
  platform: 'neutral',
  dts: {
    sourcemap: true,
  },
})
