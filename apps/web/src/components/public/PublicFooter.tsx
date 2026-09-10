import { PublicBrand } from "./PublicBrand"

export function PublicFooter() {
  return (
    <footer className="public-footer">
      <div className="public-footer__inner">
        <div><PublicBrand /><p className="public-footer__note">OpenCode, wherever you are.</p></div>
        <nav aria-label="Footer navigation">
          <a href="/install/">Install</a>
          <a href="/pair">Pair</a>
          <a href="/privacy">Privacy</a>
          <a href="https://github.com/d3vv3/remotty" target="_blank" rel="noreferrer">Source</a>
          <a href="https://github.com/d3vv3/remotty/blob/main/LICENSE" target="_blank" rel="noreferrer">AGPL-3.0</a>
        </nav>
      </div>
    </footer>
  )
}
