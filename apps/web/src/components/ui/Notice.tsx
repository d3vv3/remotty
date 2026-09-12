import type { ReactNode } from "react"
import { AlertTriangle } from "lucide-react"

export interface NoticeProps {
  children: ReactNode
  className?: string
  tone?: "warning" | "error"
  action?: ReactNode
}

export function Notice({ children, className = "", tone = "warning", action }: NoticeProps) {
  return <div className={`ui-notice ui-notice--${tone} ${className}`.trim()} role={tone === "error" ? "alert" : "status"} aria-atomic="true">
    <AlertTriangle className="ui-notice-icon" size={18} aria-hidden="true" />
    <div className="ui-notice-content">{children}</div>
    {action}
  </div>
}

export function WarningNotice({ children, className }: Pick<NoticeProps, "children" | "className">) {
  return <Notice className={className}>{children}</Notice>
}
