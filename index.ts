import process from "node:process";
import fs from "node:fs";
import { MODE, OWNER, REPO } from "./src/config/environment";
import { getChangedWorkspacesFromPR } from "./src/github/octokit";
import { createRelease } from "./src/release/release-manager";
import {
  generateWorkflowPatterns,
  triggerWorkflows,
} from "./src/deployment/deployment-manager";
import { getWorkflows } from "./src/github/octokit";
import { generateJiraTemplate } from "./src/templates/jira-template";
import sendToN8n from "./src/utils/n8n-client";

async function run() {
  const mode = MODE.toLowerCase();
  console.log(`🚀 Running Release Manager in ${mode} mode`);

  if (mode === "release" || mode === "both") {
    console.log("📝 Creating release...");
    await createRelease();
  }

  if (mode === "deploy" || mode === "both") {
    console.log("🚀 Triggering deployments...");
    const { workspaces, prUrl, version } = await getChangedWorkspacesFromPR();
    const workflowPatterns = generateWorkflowPatterns(workspaces);
    await triggerDeployments(workspaces, workflowPatterns, prUrl, version);
  }
}

async function triggerDeployments(
  workspaces: string[],
  workflowPatterns: Record<string, string[]>,
  prUrl: string,
  version: string
) {
  // 머지된 PR의 변경사항 감지
  const {
    workspaces: changedWorkspaces,
    prUrl: currentPrUrl,
    version: currentVersion,
  } = await getChangedWorkspacesFromPR();

  if (changedWorkspaces.length > 0) {
    console.log(
      `🚀 Deploying changed workspaces: ${changedWorkspaces.join(", ")}`
    );

    const workflows = await getWorkflows();
    const triggeredWorkflows = await triggerWorkflows(
      changedWorkspaces,
      workflows,
      workflowPatterns
    );

    const releaseUrl = `https://github.com/${OWNER}/${REPO}/releases/tag/v${
      currentVersion || version
    }`;

    const jiraTemplate = generateJiraTemplate(
      releaseUrl,
      currentPrUrl || prUrl,
      triggeredWorkflows,
      currentVersion || version, // 현재 버전이 있으면 사용, 없으면 전달받은 버전 사용
      workspaces
    );

    await sendToN8n(jiraTemplate, changedWorkspaces);
  } else {
    console.log("No workspaces to deploy");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
