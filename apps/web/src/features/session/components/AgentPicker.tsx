import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react"
import { Bot, Check, ChevronDown } from "lucide-react"
import { createPortal } from "react-dom"
import { useAnchoredMenu } from "../../../hooks/useAnchoredMenu"
import { resolveAgentColor } from "../model/agentColor"
import type { SessionAgent } from "../model/sessionTypes"

export function AgentPicker({ agents, value, onChange }: { agents: SessionAgent[]; value: string; onChange: (agent: string) => void }) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuStyle = useAnchoredMenu(open, triggerRef)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const colors = useMemo(() => agents.map((item, index) => resolveAgentColor(item.color, index, item.agentTheme)), [agents])
  const selectedIndex = agents.findIndex((item) => item.name === value)
  const selected = agents[selectedIndex]
  const selectedColor = resolveAgentColor(selected?.color, selectedIndex >= 0 ? selectedIndex : 0, selected?.agentTheme)

  const close = (restoreFocus = false) => {
    setOpen(false)
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus())
  }
  const show = (index = selectedIndex >= 0 ? selectedIndex : 0) => {
    if (!agents.length) return
    setActiveIndex(index)
    setOpen(true)
  }
  const select = (index: number) => {
    const item = agents[index]
    if (!item) return
    onChange(item.name)
    close(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !menuRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener("pointerdown", onPointerDown)
    return () => document.removeEventListener("pointerdown", onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    optionRefs.current[activeIndex]?.focus()
  }, [activeIndex, open])

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && open) { event.preventDefault(); close(true); return }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    event.preventDefault()
    const initial = selectedIndex >= 0 ? selectedIndex : event.key === "ArrowDown" ? 0 : agents.length - 1
    show(initial)
  }
  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.preventDefault(); close(true); return }
    if (event.key === "Tab") { close(); return }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(activeIndex); return }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault()
      const next = event.key === "Home" ? 0 : event.key === "End" ? agents.length - 1 : (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + agents.length) % agents.length
      setActiveIndex(next)
    }
  }

  return <div className="agent-control" ref={rootRef}>
    <button ref={triggerRef} type="button" className="agent-picker" style={{ "--agent-color": selectedColor } as CSSProperties} aria-label={`Agent ${value || "Select"}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => open ? close() : show()} onKeyDown={onTriggerKeyDown}>
      <span className="agent-picker-color" /><Bot size={18} style={{ color: "var(--agent-color)" }} aria-hidden="true" /><span>{value || "Select"}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div ref={menuRef} className="agent-menu" style={menuStyle} role="listbox" aria-label="Agent" onKeyDown={onMenuKeyDown}>
      {agents.map((item, index) => <button ref={(element) => { optionRefs.current[index] = element }} type="button" role="option" aria-selected={item.name === value} className={item.name === value ? "selected" : ""} style={{ "--agent-color": colors[index] } as CSSProperties} key={item.name} onClick={() => select(index)}>
        <span className="agent-color" style={{ background: colors[index] }} /><span><strong>{item.name}</strong>{item.description && <small>{item.description}</small>}</span>{item.name === value && <Check size={14} />}
      </button>)}
    </div>, document.body)}
  </div>
}
