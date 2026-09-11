import { useState } from "react"
import type { RoutedSession } from "../../relay"
import { compareSessionListEntries, folderName, sessionListPriority } from "../workspaceModel"

export function useSessionFilters(sessions: RoutedSession[], attentionKeys: Set<string>) {
  const [excludedDirectories, setExcludedDirectories] = useState<Set<string>>(() => new Set())
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
  const toggleFolder = (directory: string) => setExcludedDirectories(current => {
    const next = new Set(current)
    if (next.has(directory)) next.delete(directory)
    else next.add(directory)
    return next
  })
  return { folders, filteredSessions, toggleFolder, showAllFolders: () => setExcludedDirectories(new Set()) }
}
