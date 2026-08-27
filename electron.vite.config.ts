import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'

const projectRoot = import.meta.dirname

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(projectRoot, 'src/main/index.ts'),
          'pi-host-utility': resolve(projectRoot, 'src/main/pi-host/pi-host-utility.ts'),
          'pi-management-helper': resolve(
            projectRoot,
            'src/main/local-pi-management/pi-management-helper.ts',
          ),
        },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      lib: {
        entry: resolve(projectRoot, 'src/preload/index.ts'),
        formats: ['cjs'],
      },
    },
  },
  renderer: {
    root: projectRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': resolve(projectRoot, 'src') },
    },
    server: {
      port: 3000,
      strictPort: true,
    },
    build: {
      outDir: resolve(projectRoot, 'out/renderer'),
      rollupOptions: {
        input: resolve(projectRoot, 'index.html'),
      },
    },
  },
})
