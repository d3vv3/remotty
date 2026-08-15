import { Bell, Code2, Send, Terminal } from "lucide-react"
import { PublicBrand } from "./PublicBrand"

export function PhonePreview() {
  return (
    <div className="relative h-[570px] w-[292px] rounded-[38px] border-[10px] border-[#202526] bg-[#090a0b] p-1 shadow-[18px_22px_0_#00000080]" aria-label="remotty mobile application preview">
      <span className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-b-xl bg-[#202526]" />
      <div className="flex h-full flex-col overflow-hidden rounded-[25px] border border-[#3a4140] bg-[#090a0b]">
        <div className="flex h-8 shrink-0 items-center justify-between bg-[#111415] px-4 pt-1 font-mono text-[8px] text-[#8d9692]"><span>9:41</span><span className="text-[#73e08c]">● live</span></div>
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-[#3a4140] bg-[#0b0d0e] px-3"><PublicBrand /><Bell size={14} className="text-[#d8ff3e]" /></div>
        <div className="border-b border-[#292d2d] bg-[#101213] p-3">
          <div className="flex items-center justify-between"><div><strong className="font-mono text-[11px]">Ship pairing routes</strong><p className="mt-1 font-mono text-[7px] text-[#8d9692]">/projects/remotty</p></div><span className="size-2 rounded-full bg-[#ffbd4a]" /></div>
        </div>
        <div className="flex h-9 shrink-0 items-end gap-1 border-b border-[#292d2d] bg-[#0e1011] px-3"><span className="border-b-2 border-[#d8ff3e] px-2 pb-2 font-mono text-[8px] uppercase text-[#d8ff3e]">Activity</span><span className="px-2 pb-2 font-mono text-[8px] uppercase text-[#8d9692]">Todos 3</span><span className="px-2 pb-2 font-mono text-[8px] uppercase text-[#8d9692]">Changes 4</span></div>
        <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-3">
          <div className="ml-auto max-w-[80%] border-r-2 border-[#ff635d] bg-[#181415] p-3 text-[9px] leading-4 text-[#ffecea]">Split the landing from pairing and show the full feature set.</div>
          <div className="border-l-[3px] border-[#d8ff3e] bg-[#131617] p-3 text-[9px] leading-4 text-[#dfe6e2]">I updated the routes and kept the installed PWA focused on active sessions.</div>
          <div className="flex items-center gap-2 border border-[#42e8d455] bg-[#071817] p-2 font-mono text-[8px] text-[#42e8d4]"><Terminal size={12} /><span className="min-w-0 flex-1 truncate">Update app routing</span><span className="text-[#73e08c]">done</span></div>
          <div className="flex items-center gap-2 border border-[#42e8d455] bg-[#071817] p-2 font-mono text-[8px] text-[#42e8d4]"><Code2 size={12} /><span className="min-w-0 flex-1 truncate">Build responsive landing</span><span className="text-[#ffbd4a]">running</span></div>
        </div>
        <div className="flex h-8 shrink-0 items-center gap-2 border-t border-[#d8ff3e33] bg-[#121609] px-3 font-mono text-[8px] uppercase text-[#d8ff3e]"><span className="size-2 animate-pulse rounded-full bg-[#d8ff3e]" /> Working</div>
        <div className="grid shrink-0 grid-cols-[1fr_34px] gap-2 border-t border-[#3a4140] bg-[#0d0f10] p-2"><span className="flex h-9 items-center border border-[#3a4140] bg-[#171a1b] px-2 font-mono text-[8px] text-[#68706d]">Send another instruction...</span><span className="grid size-9 place-items-center rounded-sm bg-[#d8ff3e] text-[#080909]"><Send size={14} /></span></div>
      </div>
    </div>
  )
}
