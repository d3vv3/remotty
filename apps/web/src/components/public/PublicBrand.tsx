import { Code2 } from "lucide-react"

export function PublicBrand() {
  return (
    <a className="public-brand" href="/" aria-label="remotty home">
      <span className="public-brand__mark"><Code2 size={18} aria-hidden="true" /></span>
      <span>remotty</span>
    </a>
  )
}
