import * as React from 'react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingRow } from './common'
import { useT } from '@/i18n'

const CUSTOM_FONT = '__custom__'

export function AppearanceFontField({ label, description, customLabel, placeholder, value, options, onChange }: {
  label: string
  description: string
  customLabel: string
  placeholder: string
  value: string
  options: readonly { value: string; label: string }[]
  onChange(value: string): void
}) {
  const t = useT()
  const [customMode, setCustomMode] = React.useState(false)
  const isPreset = options.some((option) => option.value === value)
  const selectedValue = customMode || !isPreset ? CUSTOM_FONT : value || 'system'
  return <>
    <SettingRow label={label} desc={description}>
      <Select value={selectedValue} onValueChange={(next) => {
        setCustomMode(next === CUSTOM_FONT)
        if (next !== CUSTOM_FONT) onChange(next === 'system' ? '' : next)
      }}>
        <SelectTrigger className="w-52 max-w-full" aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value || 'system'} value={option.value || 'system'}>{option.label}</SelectItem>)}
          <SelectItem value={CUSTOM_FONT}>{t('settings.appearance.font.custom')}</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
    {selectedValue === CUSTOM_FONT ? <SettingRow label={customLabel}>
      <Input autoComplete="off" aria-label={customLabel} className="w-52 max-w-full" maxLength={120} placeholder={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
    </SettingRow> : null}
  </>
}
