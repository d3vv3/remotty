import type { ReactNode } from "react"

export function EmptyState({ icon, children, className }: { icon?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={["empty-state", className].filter(Boolean).join(" ")}>{icon}{children}</div>
}
