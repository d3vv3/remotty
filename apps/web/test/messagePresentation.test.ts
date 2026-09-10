import { describe, expect, it } from "vitest"
import { deliveryBadgeForMessage } from "../src/features/session/model/messagePresentation"
import { emptyMessageCache, replaceCanonicalMessages, visibleCachedMessages } from "../src/features/session/model/messageCache"
import type { SessionMessage } from "../src/features/session/model/sessionContent"

describe("message delivery presentation", () => {
  it("does not infer delivery state for canonical user messages", () => {
    expect(deliveryBadgeForMessage({ info: { role: "user" } })).toBeUndefined()
  })

  it.each(["sending", "accepted", "uncertain", "failed"] as const)("preserves explicit %s delivery", (delivery) => {
    expect(deliveryBadgeForMessage({ info: { delivery } })).toBe(delivery)
  })

  it("keeps an accepted prompt queued through canonical reconciliation, until processing starts", async () => {
    const local: SessionMessage = { info: { id: "msg_prompt", role: "user", delivery: "accepted", time: { created: 1 } }, parts: [{ type: "text", text: "Review" }] }
    const canonical: SessionMessage = { ...local, info: { id: "msg_prompt", role: "user", time: { created: 1 } } }
    let cache = emptyMessageCache<SessionMessage>()
    cache.local.messages = [local]
    expect(deliveryBadgeForMessage(local, [local])).toBe("accepted")
    cache = await replaceCanonicalMessages(cache, [canonical])
    const messages = visibleCachedMessages(cache)
    expect(messages[0]!.info.delivery).toBeUndefined()
    expect(deliveryBadgeForMessage(messages[0]!, messages)).toBe("accepted")
    const assistant: SessionMessage = { info: { id: "msg_answer", role: "assistant", parentID: "msg_prompt" }, parts: [] }
    cache = await replaceCanonicalMessages(cache, [canonical, assistant])
    const processed = visibleCachedMessages(cache)
    expect(deliveryBadgeForMessage(processed[0]!, processed)).toBeUndefined()
    expect(deliveryBadgeForMessage(local, [local, assistant])).toBeUndefined()
  })

  it("does not queue historical users and does not confuse another prompt's answer with processing", () => {
    const old: SessionMessage = { info: { id: "old", role: "user" }, parts: [] }
    const first: SessionMessage = { info: { id: "first", role: "user" }, parts: [] }
    const queued: SessionMessage = { info: { id: "queued", role: "user" }, parts: [] }
    const response: SessionMessage = { info: { id: "response", role: "assistant", parentID: "first" }, parts: [] }
    const messages = [old, first, queued, response]
    expect(deliveryBadgeForMessage(old, messages)).toBeUndefined()
    expect(deliveryBadgeForMessage(first, messages)).toBeUndefined()
    expect(deliveryBadgeForMessage(queued, messages)).toBe("accepted")
    expect(deliveryBadgeForMessage(first, [first, { ...response, info: { id: "legacy", role: "assistant" } }])).toBeUndefined()
  })
})
