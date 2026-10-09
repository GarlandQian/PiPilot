import * as React from 'react'
import type { SettingsSectionId } from './settings-navigation'

/*
 * A pane can open a page of its own (editing one provider, say). Like a
 * System Settings drill-down, the toolbar then shows that page's title and a
 * back button, and the pane's summary header steps aside.
 */

export interface SettingsSubpage {
  title: string
  back(): void
}

type Publish = (section: SettingsSectionId, page: SettingsSubpage | null) => void

const SettingsSubpageContext = React.createContext<Publish | null>(null)

export function SettingsSubpageProvider({ onChange, children }: { onChange: Publish; children: React.ReactNode }) {
  return <SettingsSubpageContext.Provider value={onChange}>{children}</SettingsSubpageContext.Provider>
}

/** Show `page` in the toolbar while it is set; `back` always calls the latest callback. */
export function useSettingsSubpage(section: SettingsSectionId, page: SettingsSubpage | null) {
  const publish = React.useContext(SettingsSubpageContext)
  const back = React.useRef(page?.back)
  back.current = page?.back
  const title = page?.title ?? null
  React.useLayoutEffect(() => {
    publish?.(section, title === null ? null : { title, back: () => back.current?.() })
  }, [publish, section, title])
  React.useLayoutEffect(() => () => publish?.(section, null), [publish, section])
}
