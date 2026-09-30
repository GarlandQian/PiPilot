import { TbArrowDown, TbFolderPlus, TbLoader2 } from 'react-icons/tb'
import { AppIcon } from '@/components/AppIcon'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export function ConversationWelcome({ projectName, selected, starting = false, onStartWriting, onOpenProject }: {
  projectName?: string
  selected: boolean
  starting?: boolean
  onStartWriting(): void
  onOpenProject(): void
}) {
  const t = useT()
  return <section className="mx-auto flex w-full max-w-xl flex-col items-center gap-2 px-6 py-12 text-center" data-conversation-welcome>
    <AppIcon className="mb-3 size-20" />
    {!selected ? <p className="text-caption text-muted-foreground">{t('chat.noSession')}</p> : null}
    <h2 className="text-[26px] leading-tight font-bold tracking-[-0.02em] text-foreground">{t('chat.welcome.title')}</h2>
    <p className="max-w-md text-app text-muted-foreground">
      {projectName ? t('chat.welcome.project', { name: projectName }) : t('chat.welcome.general')}
    </p>
    <p className="max-w-sm text-caption leading-relaxed text-muted-foreground/80">{t('chat.welcome.hint')}</p>
    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
      <Button variant="default" size="lg" onClick={onStartWriting} disabled={starting} aria-busy={starting}>
        {starting ? <TbLoader2 className="animate-spin" aria-hidden /> : <TbArrowDown aria-hidden />}
        {t(starting ? 'chat.loadingSession' : 'chat.welcome.startWriting')}
      </Button>
      {!projectName ? <Button variant="outline" size="lg" onClick={onOpenProject}><TbFolderPlus aria-hidden />{t('chat.welcome.openProject')}</Button> : null}
    </div>
  </section>
}
