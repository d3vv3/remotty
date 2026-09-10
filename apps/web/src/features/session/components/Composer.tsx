import { useLayoutEffect, useRef, type FormEvent, type KeyboardEvent, type RefObject } from "react"
import { Send } from "lucide-react"
import { IconButton } from "../../../components/ui"

export function Composer({ value, onChange, onSubmit, sending, disabled, idle, promptRef }: { value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; sending: boolean; disabled: boolean; idle: boolean; promptRef: RefObject<HTMLTextAreaElement | null> }) {
  const localRef = useRef<HTMLTextAreaElement | null>(null)
  const setRef = (element: HTMLTextAreaElement | null) => {
    localRef.current = element
    ;(promptRef as { current: HTMLTextAreaElement | null }).current = element
  }
  useLayoutEffect(() => {
    const textarea = localRef.current
    if (!textarea) return
    const resize = () => {
      textarea.style.height = "44px"
      textarea.style.height = `${value ? Math.min(textarea.scrollHeight, 82) : 44}px`
    }
    resize()
    let width = textarea.getBoundingClientRect().width
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(() => {
      const next = textarea.getBoundingClientRect().width
      if (next === width) return
      width = next
      resize()
    })
    observer?.observe(textarea)
    return () => observer?.disconnect()
  }, [value])
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }
  return <form className="composer" onSubmit={onSubmit}>
    <textarea ref={setRef} value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} placeholder={idle ? "Ask OpenCode to continue..." : "Send another instruction..."} rows={1} aria-label="Message OpenCode" />
    <IconButton variant="primary" type="submit" loading={sending} aria-label="Send prompt" icon={<Send size={19} />} disabled={!value.trim() || disabled} />
  </form>
}
