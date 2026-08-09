import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { afterEach, describe, expect, it } from "vitest"
import { workspaceGitDiff, workspaceGitPatch } from "../src/gitChanges"

const execute = promisify(execFile)
const temporary: string[] = []

const repository = async () => {
  const directory = await mkdtemp(join(tmpdir(), "remotty-git-"))
  temporary.push(directory)
  await execute("git", ["init", "-q"], { cwd: directory })
  await execute("git", ["config", "user.name", "Remotty Test"], { cwd: directory })
  await execute("git", ["config", "user.email", "remotty@example.invalid"], { cwd: directory })
  await writeFile(join(directory, ".gitignore"), "ignored.env\n")
  await writeFile(join(directory, "tracked.txt"), "before\n")
  await execute("git", ["add", ".gitignore", "tracked.txt"], { cwd: directory })
  await execute("git", ["commit", "-qm", "initial"], { cwd: directory })
  return directory
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("workspaceGitDiff", () => {
  it("compares HEAD with staged and unstaged working-tree content", async () => {
    const directory = await repository()
    await writeFile(join(directory, "tracked.txt"), "staged\n")
    await execute("git", ["add", "tracked.txt"], { cwd: directory })
    await writeFile(join(directory, "tracked.txt"), "working tree\n")
    await writeFile(join(directory, "new file.txt"), "private local content\n")
    await writeFile(join(directory, "ignored.env"), "SECRET=hidden\n")

    const result = await workspaceGitDiff(directory)

    expect(result.state).toBe("ok")
    expect(result.files.map((file) => [file.file, file.status])).toEqual([
      ["new file.txt", "untracked"],
      ["tracked.txt", "modified"],
    ])
    expect(result.files[0]).not.toHaveProperty("patch")
    expect(result.files[1]).toMatchObject({ additions: 1, deletions: 1 })
    expect(JSON.stringify(result)).not.toContain("SECRET=hidden")
    await expect(workspaceGitPatch(directory, "tracked.txt")).resolves.toMatchObject({ patch: expect.stringContaining("+working tree"), truncated: false })
  })

  it("reports tracked deletions", async () => {
    const directory = await repository()
    await rm(join(directory, "tracked.txt"))

    const result = await workspaceGitDiff(directory)

    expect(result.files).toHaveLength(1)
    expect(result.files[0]).toMatchObject({ file: "tracked.txt", status: "deleted", additions: 0, deletions: 1 })
  })

  it("distinguishes directories outside a Git working tree", async () => {
    const directory = await mkdtemp(join(tmpdir(), "remotty-no-git-"))
    temporary.push(directory)
    await expect(workspaceGitDiff(directory)).resolves.toEqual({ state: "not_git", files: [], truncated: false })
  })

  it("keeps subdirectory workspaces scoped and rejects parent traversal", async () => {
    const directory = await repository()
    const workspace = join(directory, "workspace")
    await mkdir(workspace)
    await writeFile(join(workspace, "inside.txt"), "before\n")
    await writeFile(join(directory, "outside.txt"), "before\n")
    await execute("git", ["add", "workspace/inside.txt", "outside.txt"], { cwd: directory })
    await execute("git", ["commit", "-qm", "workspace"], { cwd: directory })
    await writeFile(join(workspace, "inside.txt"), "after\n")
    await writeFile(join(directory, "outside.txt"), "after\n")

    const result = await workspaceGitDiff(workspace)

    expect(result.files.map((file) => file.file)).toEqual(["inside.txt"])
    await expect(workspaceGitPatch(workspace, "../outside.txt")).rejects.toThrow("Invalid workspace file path")
  })

  it("bounds large untracked manifests without failing the request", async () => {
    const directory = await repository()
    await Promise.all(Array.from({ length: 501 }, (_, index) => writeFile(join(directory, `untracked-${String(index).padStart(3, "0")}.txt`), "content\n")))

    const result = await workspaceGitDiff(directory)

    expect(result.state).toBe("ok")
    expect(result.files).toHaveLength(500)
    expect(result.truncated).toBe(true)
  })
})
