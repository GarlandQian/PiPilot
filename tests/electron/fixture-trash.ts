import { mkdir, realpath } from 'node:fs/promises'
import { type ElectronApplication, type TestInfo } from '@playwright/test'

/** Retain deleted fixture sessions in the test output, without using the user's Trash. */
export async function installFixtureTrash(app: ElectronApplication, testInfo: TestInfo) {
  const directory = testInfo.outputPath('fixture-trash')
  await mkdir(directory, { recursive: true })
  const root = await realpath(testInfo.outputPath())
  await app.evaluate(({ shell }, { root, directory }) => {
    const fs = process.getBuiltinModule('fs').promises
    const path = process.getBuiltinModule('path')
    Object.defineProperty(shell, 'trashItem', {
      configurable: true,
      value: async (target: string) => {
        const canonical = await fs.realpath(target)
        const ownedPath = path.relative(root, canonical)
        if (!ownedPath || ownedPath === '..' || ownedPath.startsWith(`..${path.sep}`) || path.isAbsolute(ownedPath) || path.extname(canonical) !== '.jsonl') {
          throw new Error('Unexpected non-fixture session trash target')
        }
        await fs.rename(canonical, path.join(directory, path.basename(canonical)))
      },
    })
  }, { root, directory })
  return directory
}
