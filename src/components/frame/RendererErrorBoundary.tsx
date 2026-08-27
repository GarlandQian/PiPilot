import * as React from 'react'
import { TbAlertTriangle } from 'react-icons/tb'
import { useT } from '@/i18n'
import { Button } from '@/components/ui/button'

interface RendererErrorBoundaryState {
  failed: boolean
}

function RendererErrorFallback() {
  const t = useT()

  return (
    <main className="flex h-screen min-h-0 items-center justify-center bg-background p-6 text-foreground">
      <div className="flex max-w-md flex-col items-center gap-3 text-center" role="alert">
        <TbAlertTriangle className="size-5 text-destructive" aria-hidden />
        <div className="space-y-1">
          <h1 className="text-sm font-medium">{t('app.rendererError.title')}</h1>
          <p className="text-caption text-muted-foreground">
            {t('app.rendererError.description')}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          {t('app.rendererError.reload')}
        </Button>
      </div>
    </main>
  )
}

export class RendererErrorBoundary extends React.Component<
  React.PropsWithChildren,
  RendererErrorBoundaryState
> {
  state: RendererErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): RendererErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch() {
    // Keep production diagnostics path-free; arbitrary renderer errors and
    // component stacks may contain user content or local filesystem paths.
    console.error('[PiPilot] RENDERER_TREE_ERROR')
  }

  render() {
    return this.state.failed ? <RendererErrorFallback /> : this.props.children
  }
}
