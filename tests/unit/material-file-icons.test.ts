import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MaterialFileIcon } from '@/components/inspector/MaterialFileIcon'
import {
  materialIconAssetName,
  resolveMaterialFileIconNames,
} from '@/lib/material-file-icon-resolver'

describe('Material file icon resolution', () => {
  it.each([
    ['package.json', 'nodejs'],
    ['README.md', 'readme'],
    ['Dockerfile', 'docker'],
    ['vite.config.ts', 'vite'],
    ['component.test.tsx', 'test-jsx'],
    ['types.d.ts', 'typescript-def'],
    ['logo.png', 'image'],
  ])('uses maintained filename and extension mappings for %s', (name, expected) => {
    expect(resolveMaterialFileIconNames({
      name,
      path: name,
      type: 'file',
    }).dark).toBe(expected)
  })

  it('uses path-specific filename mappings before the basename', () => {
    expect(resolveMaterialFileIconNames({
      name: 'FUNDING.yml',
      path: '.github/FUNDING.yml',
      type: 'file',
    }).dark).toBe('github-sponsors')
  })

  it('resolves named and generic folder open states without changing families', () => {
    expect(resolveMaterialFileIconNames({
      name: 'src',
      path: 'src',
      type: 'dir',
    }).dark).toBe('folder-src')
    expect(resolveMaterialFileIconNames({
      name: 'src',
      path: 'src',
      type: 'dir',
      open: true,
    }).dark).toBe('folder-src-open')
    expect(resolveMaterialFileIconNames({
      name: 'unmapped-folder',
      path: 'unmapped-folder',
      type: 'dir',
      open: true,
    }).dark).toBe('folder-open')
  })

  it('falls back to the generic Material file icon', () => {
    expect(resolveMaterialFileIconNames({
      name: 'file.unknown-extension',
      path: 'file.unknown-extension',
      type: 'file',
    })).toEqual({ dark: 'file', light: 'file' })
  })

  it('uses the theme light overrides when the package defines one', () => {
    expect(resolveMaterialFileIconNames({
      name: 'settings.toml',
      path: 'settings.toml',
      type: 'file',
    })).toEqual({ dark: 'toml', light: 'toml_light' })
  })

  it('resolves selected icon definitions to official package assets', () => {
    expect(materialIconAssetName('nodejs')).toBe('nodejs.svg')
    expect(materialIconAssetName('folder-src-open')).toBe('folder-src-open.svg')
    expect(materialIconAssetName('not-a-material-icon')).toBeUndefined()
  })

  it('renders stable decorative image geometry for files and open folders', () => {
    const fileMarkup = renderToStaticMarkup(createElement(MaterialFileIcon, {
      name: 'package.json',
      path: 'package.json',
      type: 'file',
    }))
    const folderMarkup = renderToStaticMarkup(createElement(MaterialFileIcon, {
      name: 'src',
      path: 'src',
      type: 'dir',
      open: true,
    }))

    expect(fileMarkup).toContain('aria-hidden="true"')
    expect(fileMarkup).toContain('<img')
    expect(fileMarkup).toContain('nodejs')
    expect(folderMarkup).toContain('<img')
    expect(folderMarkup).toContain('folder-src-open')

    const themedMarkup = renderToStaticMarkup(createElement(MaterialFileIcon, {
      name: 'settings.toml',
      path: 'settings.toml',
      type: 'file',
    }))
    expect(themedMarkup).toContain('dark:hidden')
    expect(themedMarkup).toContain('dark:block')
  })
})
