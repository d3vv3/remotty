import type { ReactNode } from "react"
import { AlertTriangle } from "lucide-react"

export interface NoticeProps {
  children: ReactNode
  className?: string
  tone?: "warning" | "error"
  action?: ReactNode
  as?: "div" | "span"
}

export function Notice({ children, className = "", tone = "warning", action, as: Container = "div" }: NoticeProps) {
  return <Container className={`ui-notice ui-notice--${tone} ${className}`.trim()} role={tone === "error" ? "alert" : "status"} aria-atomic="true">
    <AlertTriangle className="ui-notice-icon" size={18} aria-hidden="true" />
    <Container className="ui-notice-content">{children}</Container>
    {action}
  </Container>
}

export function WarningNotice({ children, className }: Pick<NoticeProps, "children" | "className">) {
  return <Notice className={className}>{children}</Notice>
}
