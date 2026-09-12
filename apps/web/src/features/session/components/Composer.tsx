import { useCallback, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type RefObject } from "react"
import { Send } from "lucide-react"
import { IconButton } from "../../../components/ui"
import { useComposerDraft } from "../hooks/useComposerDraft"

export function Composer({ value: initialValue, reset, onDraftChange, onChange, onSubmit, sending, disabled, idle, promptRef }: { value: string; reset?: { value: string }; onDraftChange: (value: string) => void; onChange: (value: string) => void; onSubmit: (event: FormEvent, value: string) => void; sending: boolean; disabled: boolean; idle: boolean; promptRef: RefObject<HTMLTextAreaElement | null> }) {
  const { value, change, latest } = useComposerDraft(initialValue, reset, onDraftChange, onChange)
  const localRef = useRef<HTMLTextAreaElement | null>(null)
  const resizeRef = useRef<() => void>(() => {})
  const setRef = useCallback((element: HTMLTextAreaElement | null) => {
    localRef.current = element
    ;(promptRef as { current: HTMLTextAreaElement | null }).current = element
  }, [promptRef])
  useLayoutEffect(() => {
    const textarea = localRef.current
    if (!textarea) return
    let frame: number | undefined
    const resize = () => {
      textarea.style.height = "44px"
      textarea.style.height = `${textarea.value ? Math.min(textarea.scrollHeight, 82) : 44}px`
    }
    const schedule = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => { frame = undefined; resize() })
    }
    resizeRef.current = schedule
    schedule()
    let width = textarea.getBoundingClientRect().width
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      const next = textarea.getBoundingClientRect().width
      if (next === width) return
      width = next
      schedule()
    })
    observer?.observe(textarea)
    return () => {
      observer?.disconnect()
      if (frame !== undefined) cancelAnimationFrame(frame)
    }
  }, [])
  useLayoutEffect(() => resizeRef.current(), [value])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
  return <form className="composer" onSubmit={(event) => onSubmit(event, latest.current)}>
    <textarea ref={setRef} value={value} onChange={(event) => change(event.target.value)} onKeyDown={onKeyDown} placeholder={idle ? "Ask OpenCode to continue..." : "Send another instruction..."} rows={1} aria-label="Message OpenCode" />
    <IconButton variant="primary" type="submit" loading={sending} aria-label="Send prompt" icon={<Send size={19} />} disabled={!value.trim() || disabled} />
  </form>
}
