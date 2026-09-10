import { Moon, Sun } from "lucide-react"
import { useTheme } from "../../hooks/useTheme"

export function ThemeControl({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const nextTheme = theme === "dark" ? "light" : "dark"
  const label = `Use ${nextTheme} theme`

  return (
    <button
      type="button"
      className={["theme-control", className].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      aria-pressed={theme === "light"}
      onClick={toggleTheme}
    >
      {theme === "dark" ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
    </button>
  )
}
