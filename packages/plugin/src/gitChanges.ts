import { spawn } from "node:child_process"
import { isAbsolute } from "node:path"

export type WorkspaceFileDiff = {
  file: string
  status: "added" | "modified" | "deleted" | "untracked"
  additions: number
  deletions: number
  binary?: boolean
}

export type WorkspacePatchResult = { patch?: string; truncated: boolean }

export type WorkspaceDiffResult = {
  state: "ok" | "not_git"
  files: WorkspaceFileDiff[]
  truncated: boolean
}

const MAX_FILES = 500
const MAX_MANIFEST_BYTES = 512 * 1024
const MAX_PATCH_BYTES = 256 * 1024
const GIT_TIMEOUT_MS = 10_000

class GitCommandError extends Error {
  constructor(readonly kind: "failed" | "limit", message: string, readonly output = Buffer.alloc(0)) {
    super(message)
  }
}

const runGit = (cwd: string, args: string[], maxBytes = 1024 * 1024, input?: Buffer) => new Promise<Buffer>((resolve, reject) => {
  const child = spawn("git", ["-c", "core.fsmonitor=false", "--no-pager", "--literal-pathspecs", ...args], {
    cwd,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_PAGER: "cat", LC_ALL: "C" },
    stdio: ["pipe", "pipe", "pipe"],
  })
  const output: Buffer[] = []
  const errors: Buffer[] = []
  let size = 0
  let limited = false
  const timeout = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS)

  child.stdout.on("data", (chunk: Buffer) => {
    size += chunk.length
    if (size > maxBytes) {
      limited = true
      child.kill("SIGKILL")
      return
    }
    output.push(chunk)
  })
  child.stderr.on("data", (chunk: Buffer) => errors.push(chunk))
  child.on("error", (error) => {
    clearTimeout(timeout)
    reject(new GitCommandError("failed", error.message))
  })
  child.on("close", (code) => {
    clearTimeout(timeout)
    if (limited) {
      reject(new GitCommandError("limit", "Git output exceeded its limit", Buffer.concat(output)))
      return
    }
    if (code !== 0) {
      reject(new GitCommandError("failed", Buffer.concat(errors).toString("utf8").trim() || `Git exited with status ${code}`))
      return
    }
    resolve(Buffer.concat(output))
  })
  child.stdin.end(input)
})

const runGitListing = async (cwd: string, args: string[], maxBytes: number) => {
  try {
    return { output: await runGit(cwd, args, maxBytes), truncated: false }
  } catch (error) {
    if (error instanceof GitCommandError && error.kind === "limit") {
      const complete = error.output.lastIndexOf(0)
      return { output: complete < 0 ? Buffer.alloc(0) : error.output.subarray(0, complete + 1), truncated: true }
    }
    throw error
  }
}

const nulFields = (value: Buffer) => value.toString("utf8").split("\0").filter(Boolean)

const changedFiles = (value: Buffer) => {
  const fields = nulFields(value)
  const files: Array<{ file: string; status: WorkspaceFileDiff["status"] }> = []
  for (let index = 0; index < fields.length;) {
    const field = fields[index++]!
    const separator = field.indexOf("\t")
    const code = separator >= 0 ? field.slice(0, separator) : field
    const file = separator >= 0 ? field.slice(separator + 1) : fields[index++] ?? ""
    if (!file) continue
    files.push({
      file,
      status: code.startsWith("A") ? "added" : code.startsWith("D") ? "deleted" : "modified",
    })
  }
  return files
}

const numstat = (value: Buffer) => {
  const [added = "0", deleted = "0"] = value.toString("utf8").split("\t", 2)
  return {
    additions: added === "-" ? 0 : Number.parseInt(added, 10) || 0,
    deletions: deleted === "-" ? 0 : Number.parseInt(deleted, 10) || 0,
    binary: added === "-" || deleted === "-",
  }
}

const allNumstats = (value: Buffer) => new Map(nulFields(value).flatMap((field) => {
  const first = field.indexOf("\t")
  const second = first < 0 ? -1 : field.indexOf("\t", first + 1)
  if (first < 0 || second < 0) return []
  const file = field.slice(second + 1)
  return file ? [[file, numstat(Buffer.from(field))] as const] : []
}))

const repositoryBase = async (directory: string) => {
  try {
    const inside = (await runGit(directory, ["rev-parse", "--is-inside-work-tree"])).toString("utf8").trim()
    if (inside !== "true") return undefined
  } catch {
    return undefined
  }
  try {
    return (await runGit(directory, ["rev-parse", "--verify", "HEAD"])).toString("utf8").trim()
  } catch {
    return (await runGit(directory, ["hash-object", "-t", "tree", "--stdin"], 1024, Buffer.alloc(0))).toString("utf8").trim()
  }
}

export async function workspaceGitDiff(directory: string): Promise<WorkspaceDiffResult> {
  const base = await repositoryBase(directory)
  if (!base) return { state: "not_git", files: [], truncated: false }
  const [statusListing, statsListing, untrackedListing] = await Promise.all([
    runGitListing(directory, ["diff", "--relative", "--name-status", "-z", "--no-renames", base, "--"], 2 * 1024 * 1024),
    runGitListing(directory, ["diff", "--relative", "--numstat", "-z", "--no-renames", base, "--"], 2 * 1024 * 1024),
    runGitListing(directory, ["ls-files", "--others", "--exclude-standard", "-z"], 2 * 1024 * 1024),
  ])
  const tracked = changedFiles(statusListing.output)
  const stats = allNumstats(statsListing.output)
  const untracked = nulFields(untrackedListing.output).map((file): { file: string; status: WorkspaceFileDiff["status"] } => ({ file, status: "untracked" }))
  const candidates = [...tracked, ...untracked].sort((left, right) => left.file.localeCompare(right.file))
  const files: WorkspaceFileDiff[] = []
  let manifestBytes = 0
  for (const candidate of candidates) {
    if (files.length >= MAX_FILES) break
    const file: WorkspaceFileDiff = {
      ...candidate,
      ...(candidate.status === "untracked" ? { additions: 0, deletions: 0 } : stats.get(candidate.file) ?? { additions: 0, deletions: 0 }),
    }
    const bytes = Buffer.byteLength(JSON.stringify(file))
    if (manifestBytes + bytes > MAX_MANIFEST_BYTES) break
    manifestBytes += bytes
    files.push(file)
  }
  return { state: "ok", files, truncated: statusListing.truncated || statsListing.truncated || untrackedListing.truncated || files.length < candidates.length }
}

export async function workspaceGitPatch(directory: string, file: string): Promise<WorkspacePatchResult> {
  if (isAbsolute(file) || file.includes("\0") || file.split(/[\\/]/).includes("..")) throw new Error("Invalid workspace file path")
  const base = await repositoryBase(directory)
  if (!base) return { truncated: false }
  try {
    const output = await runGit(directory, ["diff", "--relative", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3", base, "--", file], MAX_PATCH_BYTES)
    return { ...(output.length ? { patch: output.toString("utf8") } : {}), truncated: false }
  } catch (error) {
    if (error instanceof GitCommandError && error.kind === "limit") return { truncated: true }
    throw error
  }
}
