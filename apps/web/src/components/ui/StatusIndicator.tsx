export function StatusIndicator({ state, label, className }: { state: string; label?: string; className?: string }) {
  return <span className={["status-dot", state, className].filter(Boolean).join(" ")} title={label} aria-label={label} aria-hidden={label ? undefined : true} />
}
