import * as React from 'react'
import { TbChevronDown, TbFileSearch } from 'react-icons/tb'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useT } from '@/i18n'
import type { ContinuousDiffFile } from './continuous-diff-controller'

/** Navigates the existing continuous document rather than replacing its rows. */
export function DiffFileNavigator({ files, onSelect }: {
  files: readonly ContinuousDiffFile[]
  onSelect(path: string): void
}) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const pendingPath = React.useRef<string | null>(null)
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button variant="ghost" size="xs" disabled={files.length === 0} aria-label={t('workbenchReview.diff.findFile')}>
        <TbFileSearch aria-hidden /><TbChevronDown className="size-3" aria-hidden />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0" onCloseAutoFocus={(event) => {
      const path = pendingPath.current
      pendingPath.current = null
      if (!path) return
      event.preventDefault()
      onSelect(path)
    }}>
      <Command>
        <CommandInput placeholder={t('workbenchReview.diff.searchFiles')} aria-label={t('workbenchReview.diff.searchFiles')} />
        <CommandList>
          <CommandEmpty>{t('inspector.files.noSearchResults')}</CommandEmpty>
          {files.map((file) => <CommandItem key={file.id} value={file.id} keywords={[file.path, file.previousPath ?? '', t(file.stage === 'staged' ? 'inspector.diff.staged' : 'inspector.diff.unstaged')]} onSelect={() => {
            pendingPath.current = file.id
            setOpen(false)
          }}>
            <span className="min-w-0 flex-1 truncate font-mono text-caption" title={file.path}>{file.path}</span>
            <span className="shrink-0 text-micro text-muted-foreground">{t(file.stage === 'staged' ? 'inspector.diff.staged' : 'inspector.diff.unstaged')}</span>
            <span className="shrink-0 text-micro tabular-nums"><span className="text-sage">+{file.added}</span> <span className="text-destructive">−{file.deleted}</span></span>
          </CommandItem>)}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}
