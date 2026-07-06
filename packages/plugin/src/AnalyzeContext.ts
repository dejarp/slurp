import type { CommitInfo } from "./CommitInfo.js"

export interface AnalyzeContext {
  readonly worktreePath: string
  readonly commit: CommitInfo
  readonly repoPath: string
}
