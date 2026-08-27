import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useT } from '@/i18n'
import type {
  LocalPiExtensionUiRequest,
  LocalPiExtensionUiResponse,
} from '@/shared/local-pi'

type ExtensionDialogRequest = Extract<
  LocalPiExtensionUiRequest,
  { method: 'select' | 'confirm' | 'input' | 'editor' }
>

interface ExtensionUiDialogProps {
  request: ExtensionDialogRequest | null
  busy?: boolean
  onRespond(response: LocalPiExtensionUiResponse): void | Promise<void>
}

export function ExtensionUiDialog({
  request,
  busy = false,
  onRespond,
}: ExtensionUiDialogProps) {
  const t = useT()
  const [value, setValue] = React.useState('')

  React.useEffect(() => {
    if (!request) return
    setValue(request.method === 'editor' ? request.prefill ?? '' : '')
  }, [request])

  const respond = React.useCallback((response: LocalPiExtensionUiResponse) => {
    if (busy) return
    void onRespond(response)
  }, [busy, onRespond])

  if (!request) return null

  const cancel = () => respond({
    type: 'extension_ui_response',
    id: request.id,
    cancelled: true,
  })

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel()
      }}
    >
      <DialogContent
        className="max-h-[min(560px,calc(100vh-32px))] overflow-y-auto sm:max-w-md"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          {request.method === 'confirm' && (
            <DialogDescription className="whitespace-pre-wrap">
              {request.message}
            </DialogDescription>
          )}
        </DialogHeader>

        {request.method === 'select' && (
          <div className="flex max-h-72 flex-col gap-1 overflow-y-auto" role="listbox">
            {request.options.map((option) => (
              <Button
                key={option}
                variant="outline"
                className="h-auto min-h-9 justify-start whitespace-normal text-left"
                disabled={busy}
                onClick={() => respond({
                  type: 'extension_ui_response',
                  id: request.id,
                  value: option,
                })}
              >
                {option}
              </Button>
            ))}
          </div>
        )}

        {request.method === 'input' && (
          <Input
            autoFocus
            value={value}
            placeholder={request.placeholder}
            disabled={busy}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                respond({
                  type: 'extension_ui_response',
                  id: request.id,
                  value,
                })
              }
            }}
          />
        )}

        {request.method === 'editor' && (
          <Textarea
            autoFocus
            value={value}
            disabled={busy}
            rows={10}
            className="scroll-slim min-h-48 resize-y font-mono"
            onChange={(event) => setValue(event.target.value)}
          />
        )}

        {request.method !== 'select' && (
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={cancel}>
              {t('common.cancel')}
            </Button>
            {request.method === 'confirm' ? (
              <>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => respond({
                    type: 'extension_ui_response',
                    id: request.id,
                    confirmed: false,
                  })}
                >
                  {t('common.no')}
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => respond({
                    type: 'extension_ui_response',
                    id: request.id,
                    confirmed: true,
                  })}
                >
                  {t('common.yes')}
                </Button>
              </>
            ) : (
              <Button
                disabled={busy}
                onClick={() => respond({
                  type: 'extension_ui_response',
                  id: request.id,
                  value,
                })}
              >
                {t('common.ok')}
              </Button>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
