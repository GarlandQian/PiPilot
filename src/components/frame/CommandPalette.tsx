import * as React from 'react'
import {
  TbCheck,
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
import { SETTINGS_SECTIONS } from '@/components/settings/SettingsLayout'
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
  const { models, selectedModel } = usePiRuntime()
  const piActions = usePiRpcActions()
  const [page, setPage] = React.useState<PalettePage>('root')
  const [search, setSearch] = React.useState('')

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
    onOpenChange(false)
    void piActions.selectModel(model.provider, model.id).catch(() => {
      // The shared Pi runtime error state stays visible on the chat surface.
    })
  }, [onOpenChange, piActions])

  const actionCommands = ACTION_COMMANDS.filter((command) =>
    command.enabled ? command.enabled(ctx) : true)
  const sessionCommands = buildSessionCommands(sessions, ctx)
  const settingsCommands = buildSettingsCommands()

  const renderCommand = (command: AppCommand) => {
    const Icon = COMMAND_ICONS[command.id] ?? SETTINGS_ICONS.get(command.id) ?? TbSettings
    return (
      <CommandItem
        key={command.id}
        value={t(command.titleKey)}
        keywords={command.keywords?.split(' ')}
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
      <CommandInput
        placeholder={page === 'models' ? t('palette.changeModel.hint') : t('palette.placeholder')}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(event) => {
          if (page === 'models' && event.key === 'Backspace' && search === '') {
            goToRoot()
          }
        }}
      />
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
                  value={`${command.title} ${command.subtitle}`}
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
