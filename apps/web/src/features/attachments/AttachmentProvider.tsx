import { createContext, useMemo, type ReactNode } from "react"
import type { AttachmentAddress, AttachmentDescriptor } from "@remotty/protocol"

export type AttachmentReader = (workspaceRelayId: string, address: AttachmentAddress, descriptor: AttachmentDescriptor, signal?: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>
export const AttachmentContext = createContext<((address: AttachmentAddress, descriptor: AttachmentDescriptor, signal?: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>) | undefined>(undefined)
export function AttachmentProvider({ workspaceRelayId, read, children }: { workspaceRelayId: string; read: AttachmentReader; children: ReactNode }) {
  const reader = useMemo(() => (address: AttachmentAddress, descriptor: AttachmentDescriptor, signal?: AbortSignal) => read(workspaceRelayId, address, descriptor, signal), [workspaceRelayId, read])
  return <AttachmentContext.Provider value={reader}>{children}</AttachmentContext.Provider>
}
