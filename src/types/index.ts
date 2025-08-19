export interface Commit {
  message: string;
  changedFolders: string[];
}

export interface MergedPR {
  number: number;
  title: string;
  description: string;
  changedFolders: string[];
  files: string[];
  htmlUrl: string;
}

export interface Workflow {
  id: number;
  name: string;
  path: string;
}

export interface TriggeredWorkflow {
  workspace: string;
  workflowName: string;
  workflowId: number;
  url: string;
}

export interface ChangedWorkspacesResult {
  workspaces: string[];
  prUrl: string;
  version: string;
}

export interface CommitsResult {
  commits: Commit[];
  files: Array<{ filename: string }>;
}

export interface MergedPRsResult {
  mergedPRs: MergedPR[];
}
