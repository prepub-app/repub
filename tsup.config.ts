import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/fileSystem.ts'], // Include both entry points
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: false,
    clean: true,
    external: ['fs/promises'],
  //minify: true,
  //treeshake: true
});

