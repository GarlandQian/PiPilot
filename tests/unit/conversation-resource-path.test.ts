import { describe, expect, it } from 'vitest'
import { conversationResourcePath } from '../../src/renderer/conversation-resource-path'

describe('conversationResourcePath', () => {
  it('routes relative and absolute POSIX evidence without changing spaces or Unicode', () => {
    const root = '/Volumes/T7 Shield/项目/'
    expect(conversationResourcePath('src/说明 文件.md', root)).toBe('src/说明 文件.md')
    expect(conversationResourcePath('/Volumes/T7 Shield/项目/src/说明 文件.md', root)).toBe('src/说明 文件.md')
    expect(conversationResourcePath('./src//draft/../说明 文件.md', root)).toBe('src/说明 文件.md')
    expect(conversationResourcePath(' leading and trailing .md ', root)).toBe(' leading and trailing .md ')
    expect(conversationResourcePath('/file.txt', '/')).toBe('file.txt')
  })

  it('matches POSIX workspace boundaries by full, case-sensitive components', () => {
    const root = '/work/project'
    for (const path of ['/work/project-other/file.ts', '/work/Project/file.ts', '/work/project/../secret.txt', '/outside/file.ts']) {
      expect(conversationResourcePath(path, root), path).toBeNull()
    }
    expect(conversationResourcePath('/work/project/src/../file.ts', root)).toBe('file.ts')
  })

  it('normalizes Windows separators and matches the drive and workspace without case sensitivity', () => {
    const root = 'C:\\Work\\项目\\'
    expect(conversationResourcePath('c:/work/项目/Src/说明 文件.md', root)).toBe('Src/说明 文件.md')
    expect(conversationResourcePath('C:\\WORK\\项目\\Src\\file.ts', root)).toBe('Src/file.ts')
    expect(conversationResourcePath('.\\Src\\draft\\..\\file.ts', root)).toBe('Src/file.ts')
    expect(conversationResourcePath('src/file.ts', 'C:/Work/项目')).toBe('src/file.ts')
    expect(conversationResourcePath('C:\\file.ts', 'c:\\')).toBe('file.ts')
    for (const path of ['D:\\Work\\项目\\file.ts', 'C:\\Work\\项目-other\\file.ts', 'C:\\Work\\项目\\..\\secret.txt', 'C:file.ts', '\\Work\\项目\\file.ts', '/Work/项目/file.ts']) {
      expect(conversationResourcePath(path, root), path).toBeNull()
    }
  })

  it('supports UNC workspaces while separating servers, shares, and workspace boundaries', () => {
    const root = '\\\\Server\\Share\\Project'
    expect(conversationResourcePath('\\\\server\\share\\project\\src\\file.ts', root)).toBe('src/file.ts')
    expect(conversationResourcePath('//SERVER/SHARE/Project/src/file.ts', root)).toBe('src/file.ts')
    expect(conversationResourcePath('src\\file.ts', '//Server/Share/Project')).toBe('src/file.ts')
    expect(conversationResourcePath('\\\\Server\\Share\\file.ts', '\\\\Server\\Share')).toBe('file.ts')
    for (const path of ['\\\\Other\\Share\\Project\\file.ts', '\\\\Server\\Other\\Project\\file.ts', '\\\\Server\\Share\\Project-other\\file.ts', '\\\\?\\C:\\Project\\file.ts', '\\\\.\\pipe\\file']) {
      expect(conversationResourcePath(path, root), path).toBeNull()
    }
  })

  it('rejects relative traversal, workspace roots, and ambiguous home or URL paths', () => {
    for (const root of ['/work/project', 'C:\\Work\\Project', '\\\\Server\\Share\\Project']) {
      for (const path of ['', '.', './', 'src/..', '..', '../file.ts', 'src/../../file.ts', '../project/file.ts', '~/file.ts', '~other/file.ts', 'file:///work/project/file.ts', 'https://example.com/file.ts', 'data:text/plain,file.ts']) {
        expect(conversationResourcePath(path, root), `${root}: ${path}`).toBeNull()
      }
      expect(conversationResourcePath(root, root)).toBeNull()
    }
    expect(conversationResourcePath('..\\file.ts', 'C:\\Work\\Project')).toBeNull()
    expect(conversationResourcePath('file.ts', 'relative/root')).toBeNull()
    expect(conversationResourcePath('file.ts', '~/project')).toBeNull()
    expect(conversationResourcePath('file.ts', 'C:project')).toBeNull()
    expect(conversationResourcePath('file.ts', '\\\\?\\C:\\project')).toBeNull()
  })

  it('keeps unsupported names unavailable instead of changing the file that would open', () => {
    const root = '/work/project'
    for (const path of ['src\\file.ts', '/work/project/src\\file.ts', 'C:\\work\\project\\file.ts', 'file\0.ts', 'file\n.ts', 'file`name.ts', 'x'.repeat(4_097)]) {
      expect(conversationResourcePath(path, root), path).toBeNull()
    }
    expect(conversationResourcePath('file.ts', '/work/\0project')).toBeNull()
    expect(conversationResourcePath('file.txt:stream', 'C:\\Work\\Project')).toBeNull()
    expect(conversationResourcePath('src/C:other.txt', 'C:\\Work\\Project')).toBeNull()
    expect(conversationResourcePath('src/file%20name.ts', root)).toBe('src/file%20name.ts')
  })
})
