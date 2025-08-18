import { Octokit } from "@octokit/core";
import dayjs from "dayjs";
import semver from "semver";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import process from "node:process";
import fs from "node:fs";

const OWNER = process.env.GITHUB_REPOSITORY_OWNER!;
const REPO = process.env.GITHUB_REPOSITORY!.split("/")[1];
const OPENAI_API_KEY = process.env.INPUT_OPENAI_API_KEY!;
const GH_TOKEN = process.env.INPUT_GITHUB_TOKEN!;
const BASE_BRANCH = process.env.INPUT_BASE_BRANCH || "main";
const TARGET_BRANCH = process.env.INPUT_TARGET_BRANCH || "production";
const N8N_URL = process.env.INPUT_N8N_URL!;

const octo = new Octokit({ auth: GH_TOKEN });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function getWorkspacesFromRepo() {
  try {
    const { data } = await octo.request("GET /repos/{owner}/{repo}/contents", {
      owner: OWNER,
      repo: REPO,
      path: "",
    });

    const workspaces = (data as Array<{ type: string; name: string }>)
      .filter(
        (item: { type: string; name: string }) =>
          item.type === "dir" && item.name.startsWith("coloso-")
      )
      .map((item: { type: string; name: string }) => item.name);

    return workspaces;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Could not fetch workspaces from repo:", message);
    return [];
  }
}

function generateWorkflowPatterns(
  workspaces: string[]
): Record<string, string[]> {
  const patterns: Record<string, string[]> = {};

  workspaces.forEach((workspace) => {
    const serviceName = workspace.replace("coloso-", "");
    patterns[workspace] = [`deploy-production-${serviceName}.yml`];
  });

  if (patterns["coloso-intl"]) {
    patterns["coloso-intl"] = [
      "deploy-production-intl-asia.yml",
      "deploy-production-intl-us.yml",
      "deploy-production-intl-us-east.yml",
    ];
  }

  return patterns;
}

async function getLastTag() {
  try {
    const { data: releases } = await octo.request(
      "GET /repos/{owner}/{repo}/releases",
      {
        owner: OWNER,
        repo: REPO,
        per_page: 1,
      }
    );

    if (releases.length > 0 && releases[0].tag_name) {
      return releases[0].tag_name;
    }

    throw new Error("No release notes found to get last tag");
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Error getting last tag:", message);
    return "0.0.0";
  }
}

async function getCommitsSince(tag: string): Promise<{
  commits: Array<{ message: string; changedFolders: string[] }>;
  files: Array<{ filename: string }>;
}> {
  const { data } = await octo.request(
    "GET /repos/{owner}/{repo}/compare/{basehead}",
    {
      owner: OWNER,
      repo: REPO,
      basehead: `${tag}...${BASE_BRANCH}`,
    }
  );

  // 각 커밋별로 변경된 폴더 정보 매핑
  const commitsWithFolders = (data.commits as any[]).map((commit) => {
    const changedFolders = new Set<string>();

    // 해당 커밋 이후의 파일 변경사항에서 폴더 추출
    ((data.files as Array<{ filename: string }>) || []).forEach((file) => {
      if (file.filename.includes("/")) {
        const folder = file.filename.split("/")[0];
        if (folder.startsWith("coloso-")) {
          changedFolders.add(folder);
        }
      }
    });

    return {
      message: (commit as any).commit.message.split("\n")[0], // subject line only
      changedFolders: Array.from(changedFolders),
    };
  });

  return {
    commits: commitsWithFolders,
    files: (data.files as Array<{ filename: string }> | undefined) || [],
  };
}

async function generateReleaseNotes(
  commits: Array<{ message: string; changedFolders: string[] }>,
  changedWorkspaces: string[]
): Promise<string> {
  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `
You are a professional release-note writer. Analyze the provided commits and create structured Korean release notes.

**Input Format:**
Each commit includes:
- message: 커밋 메시지
- changedFolders: 변경된 폴더 목록 (예: ["coloso-backoffice", "coloso-kr"])
- changedWorkspaces: 변경된 워크스페이스 목록 (예: ["coloso-backoffice", "coloso-kr"])

**Instructions:**
- Analyze each commit based on its message AND changed folders
- Use these categories:
   - Backoffice: changedFolders에 'coloso-backoffice'가 포함된 커밋들
   - Service: KR: changedFolders에 'coloso-kr'가 포함된 커밋들  
   - Service: JP: changedFolders에 'coloso-jp'가 포함된 커밋들
   - Service: INTL: changedFolders에 'coloso-intl'가 포함된 커밋들

**Analysis Rules:**
1. 각 커밋을 해당하는 워크스페이스 카테고리로 분류
2. 커밋 메시지의 내용을 분석하여 New Features/Bug Fixes/Improvements로 세분화
3. 같은 커밋이 여러 워크스페이스에 영향을 준다면 각각에 포함
4. 워크스페이스별로 변경사항을 그룹화하여 정리

**Output Format:**
각 워크스페이스별로:

## Backoffice

### 🚀 New Features
- 사용자 인증 기능 추가

### 🐛 Bug Fixes
- 로그인 오류 수정 

## Service: KR

### 🔧 Improvements
- 성능 최적화

**Note:** 
- 각 커밋의 실제 내용과 변경된 폴더를 모두 고려하여 분류
- 한국어로 자연스럽게 작성
- 내용이 없으면 해당 분류는 생략
- changedWorkspaces가 하나도 없으면 Chore 카테고리로 분류
`,
    },
    {
      role: "user",
      content: JSON.stringify({
        commits,
        changedWorkspaces,
      }),
    },
  ];

  const chat = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages,
    max_tokens: 1000,
  });

  return chat.choices[0].message.content?.trim() || "";
}

function bumpVersion(prev: string, commits: string): string {
  if (/BREAKING|major/i.test(commits)) return semver.inc(prev, "major") || prev;
  if (/feat|feature/i.test(commits)) return semver.inc(prev, "minor") || prev;
  return semver.inc(prev, "patch") || prev;
}

async function getWorkflows() {
  try {
    const { data } = await octo.request(
      "GET /repos/{owner}/{repo}/actions/workflows",
      {
        owner: OWNER,
        repo: REPO,
      }
    );
    return data.workflows;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Could not fetch workflows:", message);
    return [];
  }
}

async function triggerWorkflows(
  changedWorkspaces: string[],
  workflows: Array<{ id: number; name: string; path: string }>,
  workflowPatterns: Record<string, string[]>
): Promise<
  Array<{
    workspace: string;
    workflowName: string;
    workflowId: number;
    url: string;
  }>
> {
  const triggeredWorkflows: Array<{
    workspace: string;
    workflowName: string;
    workflowId: number;
    url: string;
  }> = [];

  for (const workspace of changedWorkspaces) {
    const patterns = workflowPatterns[workspace] || [];

    for (const pattern of patterns) {
      const workflow = workflows.find(
        (workflow) =>
          workflow.name
            .toLowerCase()
            .includes(pattern.replace(".yml", "").toLowerCase()) ||
          workflow.path.toLowerCase().includes(pattern.toLowerCase())
      );

      if (workflow) {
        try {
          await octo.request(
            "POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches",
            {
              owner: OWNER,
              repo: REPO,
              workflow_id: workflow.id,
              ref: TARGET_BRANCH,
            }
          );

          const { data: runs } = await octo.request(
            "GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs",
            {
              owner: OWNER,
              repo: REPO,
              workflow_id: workflow.id,
              per_page: 1,
            }
          );

          const runUrl = runs.workflow_runs[0]
            ? runs.workflow_runs[0].html_url
            : `https://github.com/${OWNER}/${REPO}/actions/workflows/${workflow.path}`;

          triggeredWorkflows.push({
            workspace,
            workflowName: workflow.name,
            workflowId: workflow.id,
            url: runUrl,
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(
            `❌ Failed to trigger workflow ${workflow.name}:`,
            message
          );
        }
      } else {
        console.warn(
          `⚠️  No workflow found for ${workspace} with patterns: ${patterns.join(
            ", "
          )}`
        );
      }
    }
  }

  return triggeredWorkflows;
}

function generateJiraTemplate(
  prUrl: string,
  triggeredWorkflows: Array<{
    workspace: string;
    workflowName: string;
    workflowId: number;
    url: string;
  }>,
  nextVersion: string,
  workspaces: string[]
): string {
  const workspaceGroups: Record<
    string,
    Array<{
      workspace: string;
      workflowName: string;
      workflowId: number;
      url: string;
    }>
  > = {};

  // 동적으로 워크스페이스 그룹 초기화
  workspaces.forEach((workspace) => {
    workspaceGroups[workspace] = [];
  });

  triggeredWorkflows.forEach((wf) => {
    if (workspaceGroups[wf.workspace]) {
      workspaceGroups[wf.workspace].push(wf);
    }
  });

  let template = `h2. Release v${nextVersion}\n\n`;

  // 각 서비스별로 섹션 생성
  const services = workspaces.map((workspace) => {
    const serviceName = workspace.replace("coloso-", "");
    const displayName =
      {
        kr: "Korea Service",
        jp: "Japan Service",
        intl: "International Service",
        backoffice: "Backoffice",
      }[serviceName] || `${serviceName} Service`;

    return { key: workspace, name: displayName };
  });

  services.forEach((service) => {
    const workflows = workspaceGroups[service.key];
    if (workflows && workflows.length > 0) {
      template += `h2. ${service.name}\n\n`;
      template += `*Pull Request:* [${prUrl}|${prUrl}|smart-link]\n`;
      template += `*Branch:* {{${TARGET_BRANCH}}}\n`;
      template += `*Actions:* `;

      workflows.forEach((wf, index) => {
        if (index > 0) template += ", ";
        template += `[${wf.workflowName}|${wf.url}]`;
      });

      template += `\n\n`;
    }
  });

  return template;
}

async function sendToN8n(
  jiraTemplate: string,
  changedWorkspaces: string[]
): Promise<boolean> {
  try {
    const payload = {
      jiraTemplate,
      changedWorkspaces,
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(N8N_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("❌ Failed to send to n8n webhook:", message);
    return false;
  }
}

async function getChangedWorkspaces(
  files: Array<{ filename: string }>
): Promise<string[]> {
  const changedWorkspaces = files.map((file) => {
    if (file.filename.includes("coloso-")) {
      return file.filename.split("/")[0];
    }
    return null;
  });
  return changedWorkspaces.filter((ws): ws is string => ws !== null);
}

async function run() {
  // 동적으로 워크스페이스 감지
  const workspaces = await getWorkspacesFromRepo();
  const workflowPatterns = generateWorkflowPatterns(workspaces);

  const lastTag = await getLastTag();
  const { commits, files } = await getCommitsSince(lastTag);

  const nextVersion =
    bumpVersion(
      lastTag.replace(/^v?/, ""),
      commits.map((c) => c.message).join("\n")
    ) || "0.0.1";

  const changedWorkspaces = await getChangedWorkspaces(files);
  const noteMd = await generateReleaseNotes(commits, changedWorkspaces);

  const branch = `release/${dayjs().format(
    "YYYY-MM-DD-HHmmss"
  )}-v${nextVersion}`;

  const { data: mainRef } = await octo.request(
    "GET /repos/{owner}/{repo}/git/ref/{ref}",
    {
      owner: OWNER,
      repo: REPO,
      ref: `heads/${BASE_BRANCH}`,
    }
  );

  // 태그 생성
  await octo.request("POST /repos/{owner}/{repo}/git/refs", {
    owner: OWNER,
    repo: REPO,
    ref: `refs/tags/v${nextVersion}`, // 태그!
    sha: mainRef.object.sha,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  // 브랜치 생성
  await octo.request("POST /repos/{owner}/{repo}/git/refs", {
    owner: OWNER,
    repo: REPO,
    ref: `refs/heads/${branch}`,
    sha: mainRef.object.sha,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  const { data: pr } = await octo.request("POST /repos/{owner}/{repo}/pulls", {
    owner: OWNER,
    repo: REPO,
    title: `Release v${nextVersion}`,
    head: branch,
    base: TARGET_BRANCH,
    body: `## v${nextVersion}\n\n${noteMd}\n\n### Changed Workspaces\n${changedWorkspaces
      .map((workspace) => `- ${workspace}`)
      .join("\n")}`,
  });

  if (changedWorkspaces.length > 0) {
    const workflows = await getWorkflows();
    const triggeredWorkflows = await triggerWorkflows(
      changedWorkspaces,
      workflows,
      workflowPatterns
    );

    const jiraTemplate = generateJiraTemplate(
      pr.html_url,
      triggeredWorkflows,
      nextVersion,
      workspaces
    );

    await sendToN8n(jiraTemplate, changedWorkspaces);
  }

  if (process.env["GITHUB_OUTPUT"]) {
    fs.appendFileSync(
      process.env["GITHUB_OUTPUT"],
      `pr_url=${pr.html_url}\ndeployed_workspaces=${changedWorkspaces.join(
        ","
      )}\n`
    );
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
