import * as React from 'react'
import {
  TbCheck,
  TbArrowLeft,
  TbLoader2,
  TbCpu,
  TbLayoutSidebar,
  TbLayoutSidebarRight,
  TbMessage,
  TbMessagePlus,
  TbMessages,
  TbPlayerStop,
  TbServer,
  TbSettings,
} from 'react-icons/tb'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { SETTINGS_SECTIONS } from '@/components/settings/settings-navigation'
import { useT } from '@/i18n'
import {
  ACTION_COMMANDS,
  buildSessionCommands,
  buildSettingsCommands,
  CHANGE_MODEL_COMMAND_ID,
  NAVIGATION_COMMANDS,
  type AppCommand,
  type CommandContext,
  type SessionCommandEntry,
} from '@/lib/commands'
import { groupModelsByProvider } from '@/lib/model-groups'
import { primaryShortcut } from '@/lib/keyboard-shortcuts'
import { cn } from '@/lib/utils'
import { type PiRpcModel, usePiRpcActions, usePiRuntime } from '@/store/pi-rpc'
import { Button } from '@/components/ui/button'
import { useConversationOperationFeedback } from '@/renderer/composer/use-operation-feedback'

export interface CommandPaletteProps {
  open: boolean
  onOpenChange(open: boolean): void
  ctx: CommandContext
  sessions: readonly SessionCommandEntry[]
}

const COMMAND_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  'action:new-session': TbMessagePlus,
  [CHANGE_MODEL_COMMAND_ID]: TbCpu,
  'action:toggle-context-panel': TbLayoutSidebar,
  'action:toggle-inspector': TbLayoutSidebarRight,
  'action:stop-generation': TbPlayerStop,
  'nav:sessions': TbMessages,
  'nav:settings': TbSettings,
  'nav:integrations-mcp': TbServer,
}

const SETTINGS_ICONS = new Map(SETTINGS_SECTIONS.map((meta) => [`settings:${meta.id}`, meta.icon]))

type PalettePage = 'root' | 'models'

/**
 * Primary-modifier command palette: fuzzy session switching plus the frame's core
 * navigation/actions. cmdk supplies keyboard operation and filtering;
 * reduced motion is honored globally by globals.css zeroing dialog
 * animations under [data-reduced-motion='true'] / prefers-reduced-motion.
 *
 * The `change-model` command opens a nested model-picker page inside the
 * same dialog (cmdk sub-page pattern): Esc or Backspace on an empty filter
 * steps back to the root page, picking a model closes the palette.
 */
export function CommandPalette({ open, onOpenChange, ctx, sessions }: CommandPaletteProps) {
  const t = useT()
  const { models, selectedModel, runtime, session } = usePiRuntime()
  const piActions = usePiRpcActions()
  const [page, setPage] = React.useState<PalettePage>('root')
  const [search, setSearch] = React.useState('')
  const modelFeedback = useConversationOperationFeedback(`palette:${open}:${page}:${runtime?.generation ?? 0}:${session?.sessionId ?? ''}`)

  // Closed dialogs unmount their content; reset the page so the next open
  // always starts on the root page with a clean filter.
  React.useEffect(() => {
    if (!open) {
      setPage('root')
      setSearch('')
    }
  }, [open])

  const modelGroups = React.useMemo(() => groupModelsByProvider(models), [models])

  const runCommand = React.useCallback((run: () => void) => {
    onOpenChange(false)
    run()
  }, [onOpenChange])

  const goToRoot = React.useCallback(() => {
    setPage('root')
    setSearch('')
  }, [])

  const chooseModel = React.useCallback((model: PiRpcModel) => {
    if (model.provider === selectedModel?.provider && model.id === selectedModel.id) {
      onOpenChange(false)
      return
    }
    void modelFeedback.run(`${model.provider}/${model.id}`, async (isCurrent) => {
      await piActions.selectModel(model.provider, model.id)
      if (isCurrent()) onOpenChange(false)
    }, t('workbenchReview.palette.modelFailed'))
  }, [modelFeedback, onOpenChange, piActions, selectedModel, t])

  const actionCommands = ACTION_COMMANDS.filter((command) =>
    command.enabled ? command.enabled(ctx) : true)
  const sessionCommands = buildSessionCommands(sessions, ctx)
  const settingsCommands = buildSettingsCommands()

  const renderCommand = (command: AppCommand) => {
    const Icon = COMMAND_ICONS[command.id] ?? SETTINGS_ICONS.get(command.id) ?? TbSettings
    return (
      <CommandItem
        key={command.id}
        value={command.id}
        keywords={[t(command.titleKey), ...(command.keywords?.split(' ') ?? [])]}
        onSelect={() => {
          if (command.id === CHANGE_MODEL_COMMAND_ID) {
            setSearch('')
            setPage('models')
            return
          }
          runCommand(() => command.run(ctx))
        }}
      >
        <Icon aria-hidden />
        <span className="truncate">{t(command.titleKey)}</span>
        {command.shortcut
          ? <CommandShortcut>{primaryShortcut(command.shortcut)}</CommandShortcut>
          : command.hintKey
            ? <CommandShortcut className="tracking-normal">{t(command.hintKey)}</CommandShortcut>
            : null}
      </CommandItem>
    )
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('rail.palette')}
      description={t('palette.description')}
      showCloseButton={false}
      className="top-[18%] translate-y-0 sm:max-w-xl"
      onEscapeKeyDown={(event) => {
        // On a sub-page, Esc steps back to the root instead of closing.
        if (page !== 'root') {
          event.preventDefault()
          goToRoot()
        }
      }}
    >
      {page === 'models' ? <div className="flex min-h-10 items-center gap-2 border-b border-border px-2">
        <Button variant="ghost" size="icon-xs" aria-label={t('common.back')} onClick={goToRoot}><TbArrowLeft aria-hidden /></Button>
        <span className="text-caption font-medium">{t('palette.changeModel')}</span>
        {modelFeedback.pending ? <span role="status" className="ml-auto flex items-center gap-1.5 text-micro text-muted-foreground"><TbLoader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />{t('workbenchReview.palette.changingModel')}</span> : null}
      </div> : null}
      <CommandInput
        placeholder={page === 'models' ? t('palette.changeModel.hint') : t('palette.placeholder')}
        value={search}
        disabled={modelFeedback.pending !== null}
        onValueChange={setSearch}
        onKeyDown={(event) => {
          if (page === 'models' && event.key === 'Backspace' && search === '') {
            goToRoot()
          }
        }}
      />
      {page === 'models' && modelFeedback.error ? <p role="alert" className="border-b border-border px-3 py-2 text-caption text-destructive">{modelFeedback.error}</p> : null}
      {page === 'models' ? (
        <CommandList>
          <CommandEmpty>
            {models.length === 0 ? t('palette.models.empty') : t('palette.empty')}
          </CommandEmpty>
          {modelGroups.map((group) => (
            <CommandGroup key={group.provider} heading={group.provider}>
              {group.models.map((model) => {
                const active = selectedModel?.provider === model.provider &&
                  selectedModel.id === model.id
                return (
                  <CommandItem
                    key={`${model.provider}/${model.id}`}
                    value={`${model.name || model.id} ${model.provider}/${model.id}`}
                    disabled={modelFeedback.pending !== null}
                    onSelect={() => chooseModel(model)}
                  >
                    <TbCheck
                      aria-hidden
                      className={cn(active ? 'opacity-100' : 'opacity-0')}
                    />
                    <span className="truncate">{model.name || model.id}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          ))}
        </CommandList>
      ) : (
        <CommandList>
          <CommandEmpty>{t('palette.empty')}</CommandEmpty>
          <CommandGroup heading={t('palette.group.actions')}>
            {[...actionCommands, ...NAVIGATION_COMMANDS].map(renderCommand)}
          </CommandGroup>
          {sessionCommands.length > 0 && (
            <CommandGroup heading={t('palette.group.sessions')}>
              {sessionCommands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={command.id}
                  keywords={[command.title, command.subtitle]}
                  onSelect={() => runCommand(command.run)}
                >
                  <TbMessage aria-hidden />
                  <span className="truncate">{command.title}</span>
                  <CommandShortcut className="tracking-normal">
                    {command.subtitle}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup heading={t('palette.group.settings')}>
            {settingsCommands.map(renderCommand)}
          </CommandGroup>
        </CommandList>
      )}
    </CommandDialog>
  )
}
