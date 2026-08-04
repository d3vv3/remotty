import type { TuiPlugin, TuiPluginModule, TuiRouteCurrent } from "@opencode-ai/plugin/tui"

export const selectedSessionId = (route: TuiRouteCurrent) => {
  if (route.name !== "session" || !route.params || typeof route.params.sessionID !== "string") return undefined
  return route.params.sessionID
}

const tui: TuiPlugin = async (api) => {
  let selected: string | undefined
  const publishSelection = () => {
    const next = selectedSessionId(api.route.current)
    if (!next) {
      selected = undefined
      return
    }
    if (next === selected) return
    selected = next
    void api.client.tui.publish({
      body: { type: "tui.session.select", properties: { sessionID: next } },
    }).then((result) => {
      if (result.error && selected === next) selected = undefined
    }, () => {
      if (selected === next) selected = undefined
    })
  }
  publishSelection()
  const timer = setInterval(publishSelection, 250)
  api.lifecycle.onDispose(() => clearInterval(timer))
}

const plugin: TuiPluginModule & { id: string } = {
  id: "remotty.session-selection",
  tui,
}

export default plugin
