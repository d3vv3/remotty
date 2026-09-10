import type { KeyboardEvent, ReactNode } from "react"

export type TabOption<T extends string> = { value: T; label: ReactNode; panelId?: string; working?: boolean; accessibleLabel?: string }

export function Tabs<T extends string>({ id, value, options, onChange, label, orientation = "horizontal" }: { id: string; value: T; options: TabOption<T>[]; onChange: (value: T) => void; label: string; orientation?: "horizontal" | "vertical" }) {
  const selectFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % options.length
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + options.length) % options.length
    else if (event.key === "Home") nextIndex = 0
    else if (event.key === "End") nextIndex = options.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const next = options[nextIndex]
    if (!next) return
    onChange(next.value)
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus()
  }

  return <div className="tabs" role="tablist" aria-label={label} aria-orientation={orientation}>{options.map((option, index) => {
    const selected = option.value === value
    return <button key={option.value} id={`${id}-${option.value}-tab`} type="button" role="tab" aria-label={option.accessibleLabel} data-working={option.working || undefined} aria-selected={selected} aria-controls={option.panelId ?? `${id}-${option.value}-panel`} tabIndex={selected ? 0 : -1} className={selected ? "active" : ""} onKeyDown={(event) => selectFromKeyboard(event, index)} onClick={() => onChange(option.value)}>{option.label}</button>
  })}</div>
}
