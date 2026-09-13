import { TbArrowDown, TbFolderPlus } from 'react-icons/tb'
import { PiLogo } from '@/components/PiLogo'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n'

export function ConversationWelcome({ projectName, selected, onOpenProject }: {
  projectName?: string
  selected: boolean
  onOpenProject(): void
}) {
  const t = useT()
  return <section className="mx-auto flex w-full max-w-2xl flex-col items-start gap-5 px-6 py-12 text-left" data-conversation-welcome>
    <PiLogo className="mb-3 size-9 text-sage" />
    {!selected ? <p className="text-caption text-muted-foreground">{t('chat.noSession')}</p> : null}
    <h2 className="text-3xl font-medium tracking-tight text-foreground">{t('chat.welcome.title')}</h2>
    <p className="max-w-md text-app text-muted-foreground">
      {projectName ? t('chat.welcome.project', { name: projectName }) : t('chat.welcome.general')}
    </p>
    <p className="max-w-sm text-caption leading-relaxed text-muted-foreground">{t('chat.welcome.hint')}</p>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <Button variant="default" onClick={() => {
        document.querySelector<HTMLElement>('[data-composer-root] [contenteditable="true"]')?.focus()
      }}><TbArrowDown aria-hidden />{t('chat.welcome.startWriting')}</Button>
      {!projectName ? <Button variant="ghost" onClick={onOpenProject}><TbFolderPlus aria-hidden />{t('chat.welcome.openProject')}</Button> : null}
    </div>
  </section>
}
