import type { AriaAttributes, ReactNode } from "react"

type FieldControlProps = Pick<AriaAttributes, "aria-describedby" | "aria-invalid">

export function Field({ id, label, hint, error, children }: { id: string; label: ReactNode; hint?: ReactNode; error?: ReactNode; children: (controlProps: FieldControlProps) => ReactNode }) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined
  return <>
    <label htmlFor={id}>{label}</label>
    {children({ "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
    {hint && <small id={hintId}>{hint}</small>}
    {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
  </>
}
