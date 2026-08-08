type JsonObject = Record<string, unknown>

export const promptBody = (session: JsonObject, text: string, agent?: string, messageId?: string) => {
  const model = session.model as JsonObject | undefined
  const providerID = model?.providerID
  const modelID = model?.modelID ?? model?.id
  return {
    ...(typeof session.agent === "string" ? { agent: session.agent } : {}),
    ...(typeof providerID === "string" && typeof modelID === "string" ? { model: { providerID, modelID } } : {}),
    ...(agent ? { agent } : {}),
    ...(messageId ? { messageID: messageId } : {}),
    parts: [{ type: "text" as const, text }],
  }
}
