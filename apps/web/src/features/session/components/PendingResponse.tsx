import { Brain, Network, Wrench } from "lucide-react"
import type { PendingPhase } from "../model/activityPresentation"

export function PendingResponse({ phase, author = "OpenCode", subagent = false }: { phase: PendingPhase; author?: string; subagent?: boolean }) {
  const Icon = phase === "tool" ? Wrench : Brain
  const action = phase === "delegating" ? "is running a subagent" : phase === "tool" ? "is running a tool" : "is thinking"
  const label = `${author}${subagent ? " (subagent)" : ""} ${action}`
  return <div className="pending-response" role="status" aria-label={label} title={label}>{(subagent || phase === "delegating") && <Network size={18} aria-hidden="true" />}{phase !== "delegating" && <Icon size={18} aria-hidden="true" />}<span aria-hidden="true"><i /><i /><i /></span></div>
}
