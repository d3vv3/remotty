import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react"
import { LoaderCircle } from "lucide-react"

type ButtonVariant = "primary" | "secondary" | "danger" | "permission"
type ButtonSize = "sm" | "md" | "icon"

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant
  size?: ButtonSize
  type?: "button" | "submit" | "reset"
  loading?: boolean
  loadingLabel?: ReactNode
  startIcon?: ReactNode
  endIcon?: ReactNode
}

export const buttonClassName = (variant: ButtonVariant, size: ButtonSize, className?: string) => (
  ["ui-button", `ui-button--${variant}`, `ui-button--${size}`, className].filter(Boolean).join(" ")
)

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = "secondary",
  size = "md",
  type = "button",
  loading = false,
  loadingLabel,
  startIcon,
  endIcon,
  children,
  className,
  disabled,
  ...props
}, ref) {
  const leadingIcon = loading ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : startIcon
  return (
    <button
      {...props}
      ref={ref}
      className={[buttonClassName(variant, size, className), loading && "ui-button--loading", loading && !startIcon && "ui-button--loading-no-start-icon"].filter(Boolean).join(" ")}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {leadingIcon && <span className="ui-button__icon" aria-hidden={loading ? undefined : true}>{leadingIcon}</span>}
      {loading && loadingLabel !== undefined ? loadingLabel : children}
      {endIcon && <span className="ui-button__icon" aria-hidden="true">{endIcon}</span>}
    </button>
  )
})

export type IconButtonProps = Omit<ButtonProps, "children" | "startIcon" | "aria-label"> & {
  "aria-label": string
  icon: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  "aria-label": ariaLabel,
  icon,
  title = ariaLabel,
  size = "icon",
  ...props
}, ref) {
  return <Button {...props} ref={ref} size={size} aria-label={ariaLabel} title={title} startIcon={icon} />
})
