import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'electron-vite'
import { describePackage, thirdPartyNotices } from './build/third-party-notices.mjs'

const projectRoot = import.meta.dirname
const require = createRequire(import.meta.url)
const packageDirectory = (name: string) => dirname(require.resolve(`${name}/package.json`))
// npm is copied into the package whole (build/apply-electron-fuses.cjs), with its own notices.
const notices = { projectRoot, excluded: ['pipilot-npm'] }

export default defineConfig({
  main: {
    plugins: [thirdPartyNotices(notices)],
    build: {
      rollupOptions: {
        input: {
          index: resolve(projectRoot, 'src/main/index.ts'),
          'npm-runner': resolve(projectRoot, 'src/main/npm-runner.ts'),
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
    plugins: [thirdPartyNotices(notices)],
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
    plugins: [react(), tailwindcss(), thirdPartyNotices({
      ...notices,
      write: true,
      outFile: resolve(projectRoot, 'out/renderer/third-party-notices.json'),
      // Shipped with their own license files: Electron (LICENSE.electron.txt, LICENSES.chromium.html) and npm.
      extra: [describePackage(packageDirectory('electron')), { ...describePackage(packageDirectory('pipilot-npm')), name: 'npm' }],
    })],
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
