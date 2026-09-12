import { useLayoutEffect, useRef, useState } from "react"

// Parent echoes are deliberately ignored: an older debounced value must never
// replace newer typing or move the caret. Only an explicit reset replaces it.
export function useComposerDraft(initialValue: string, reset: { value: string } | undefined, onDraftChange: (value: string) => void, onChange: (value: string) => void) {
  const [value, setValue] = useState(initialValue)
  const latest = useRef(initialValue)
  const previousReset = useRef(reset)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const callbacks = useRef({ onDraftChange, onChange })
  useLayoutEffect(() => { callbacks.current = { onDraftChange, onChange } })
  const cancel = () => {
    clearTimeout(timer.current)
    timer.current = undefined
  }
  useLayoutEffect(() => {
    if (previousReset.current === reset) return
    previousReset.current = reset
    if (!reset) return
    cancel()
    latest.current = reset.value
    setValue(reset.value)
  }, [reset])
  useLayoutEffect(() => () => {
    // Keep the parent current when the composer is hidden by a tab switch.
    // Session retention itself is synchronous and never depends on this flush.
    if (timer.current !== undefined) callbacks.current.onChange(latest.current)
    cancel()
  }, [])
  const change = (next: string) => {
    latest.current = next
    setValue(next)
    callbacks.current.onDraftChange(next)
    cancel()
    timer.current = setTimeout(() => {
      timer.current = undefined
      callbacks.current.onChange(latest.current)
    }, 120)
  }
  return { value, change, latest }
}
