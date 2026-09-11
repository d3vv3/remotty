import { useMemo } from "react"
import { usePreference } from "../../../hooks/usePreference"
import { createLocalPreference } from "../../../infrastructure/preferences/localPreference"
import type { RoutedSession } from "../../relay"
import { compareSessionListEntries, folderName, sessionListPriority } from "../workspaceModel"

const emptyDirectories: readonly string[] = Object.freeze([])
const hiddenFoldersPreference = createLocalPreference<readonly string[]>({
  key: "remotty-hidden-session-folders-v1",
  defaultValue: emptyDirectories,
  parse: raw => {
    const stored: unknown = JSON.parse(raw ?? "[]")
    return Array.isArray(stored) && stored.every(directory => typeof directory === "string")
      ? Object.freeze([...new Set<string>(stored)]) : emptyDirectories
  },
  serialize: value => JSON.stringify(value),
})

export function useSessionFilters(sessions: RoutedSession[], attentionKeys: Set<string>) {
  const [hiddenDirectories, setHiddenDirectories] = usePreference(hiddenFoldersPreference)
  const excludedDirectories = useMemo(() => new Set(hiddenDirectories), [hiddenDirectories])
  const directories = [...new Set(sessions.map(session => session.directory))]
    .sort((a, b) => folderName(a).localeCompare(folderName(b)) || a.localeCompare(b))
  const folders = directories.map(directory => ({
    directory,
    label: directories.some(other => other !== directory && folderName(other) === folderName(directory)) ? directory : folderName(directory),
    enabled: !excludedDirectories.has(directory),
  }))
  const filteredSessions = sessions.filter(session => !excludedDirectories.has(session.directory))
    .sort((a, b) => compareSessionListEntries(a, b, session => sessionListPriority(
      session, attentionKeys.has(`${session.workspaceRelayId}:${session.id}`), false,
    )))
  const toggleFolder = (directory: string) => hiddenFoldersPreference.update(current => {
    const next = new Set(current)
    if (next.has(directory)) next.delete(directory)
    else next.add(directory)
    return Object.freeze([...next])
  })
  return { folders, filteredSessions, toggleFolder, showAllFolders: () => setHiddenDirectories(emptyDirectories) }
}
