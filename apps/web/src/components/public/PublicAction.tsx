import type { AnchorHTMLAttributes } from "react"

export function PublicAction({ secondary = false, compact = false, className = "", ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { secondary?: boolean; compact?: boolean }) {
  return <a {...props} className={`public-action${secondary ? " public-action--secondary" : ""}${compact ? " public-action--compact" : ""} ${className}`} />
}
