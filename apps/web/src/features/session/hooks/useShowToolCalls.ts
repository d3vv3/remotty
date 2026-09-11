import { usePreference } from "../../../hooks/usePreference"
import { createLocalPreference } from "../../../infrastructure/preferences/localPreference"

const showToolCallsPreference = createLocalPreference({
  key: "remotty.show-tool-calls",
  defaultValue: true,
  parse: raw => raw !== "false",
  serialize: String,
})

export function useShowToolCalls() {
  return usePreference(showToolCallsPreference)
}
