import { Github, LockKeyhole, Terminal } from "lucide-react"
import { ThemeControl } from "../ui/ThemeControl"
import { PublicBrand } from "./PublicBrand"
import { PublicAction } from "./PublicAction"

type PublicHeaderProps = {
  active?: "install" | "pair" | "privacy"
}

export function PublicHeader({ active }: PublicHeaderProps) {
  return (
    <header className="public-header">
      <nav className="public-header__inner" aria-label="Primary navigation">
        <PublicBrand />
        <div className="public-header__links">
          <a aria-label="Install remotty" aria-current={active === "install" ? "page" : undefined} href="/install/"><Terminal aria-hidden="true" /> <span>Install</span></a>
          <a aria-label="Privacy" aria-current={active === "privacy" ? "page" : undefined} href="/privacy"><LockKeyhole aria-hidden="true" /> <span>Privacy</span></a>
          <a aria-label="View remotty source on GitHub" className="public-header__source" href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer"><Github aria-hidden="true" /> <span>Source</span></a>
          <ThemeControl />
           <PublicAction compact aria-current={active === "pair" ? "page" : undefined} href="/pair">Pair device</PublicAction>
        </div>
      </nav>
    </header>
  )
}
