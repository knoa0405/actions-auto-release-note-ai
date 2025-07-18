import { Octokit } from "@octokit/core";
import dayjs from "dayjs";
import semver from "semver";
import OpenAI from "openai";
import process from "node:process";
import fs from "node:fs";

const OWNER = process.env.GITHUB_REPOSITORY_OWNER;
const REPO = process.env.GITHUB_REPOSITORY.split("/")[1];
const OPENAI_API_KEY = process.env.INPUT_OPENAI_API_KEY;
const GH_TOKEN = process.env.INPUT_GITHUB_TOKEN;
const BASE_BRANCH = process.env.INPUT_BASE_BRANCH || "main";
const TARGET_BRANCH = process.env.INPUT_TARGET_BRANCH || "production";
const N8N_WEBHOOK_URL = process.env.INPUT_N8N_WEBHOOK_URL;

const octo = new Octokit({ auth: GH_TOKEN });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// 워크스페이스 매핑
const WORKSPACE_MAPPING = {
  kr: "coloso-kr",
  jp: "coloso-jp",
  intl: "coloso-intl",
  bo: "coloso-backoffice",
};

// 워크플로우 패턴 매핑
const WORKFLOW_PATTERNS = {
  kr: ["deploy-production-kr.yml"],
  jp: ["deploy-production-jp.yml"],
  intl: [
    "deploy-production-intl-asia.yml",
    "deploy-production-intl-us.yml",
    "deploy-production-intl-us-east.yml",
  ],
  bo: ["deploy-production-backoffice.yml"],
};

async function getLastTag() {
  const { data } = await octo.request("GET /repos/{owner}/{repo}/tags", {
    owner: OWNER,
    repo: REPO,
  });

  return data.at(-1)?.name ?? "0.0.0";
}

async function getCommitsSince(tag) {
  const { data } = await octo.request(
    "GET /repos/{owner}/{repo}/compare/{basehead}",
    {
      owner: OWNER,
      repo: REPO,
      basehead: `${tag}...${BASE_BRANCH}`,
    }
  );
  return data.commits.map((c) => c.commit.message.split("\n")[0]); // subject line only
}

async function generateReleaseNotes(commits) {
  const messages = [
    {
      role: "system",
      content:
        "You are a professional release-note writer. Group commits by type and produce concise, human‑friendly Korean release notes in Markdown bullet lists. The output should be in Korean.",
    },
    { role: "user", content: JSON.stringify(commits) },
  ];

  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 1000,
  });

  return chat.choices[0].message.content.trim();
}

function bumpVersion(prev, commits) {
  if (/BREAKING|major/i.test(commits)) return semver.inc(prev, "major");
  if (/feat|feature/i.test(commits)) return semver.inc(prev, "minor");
  return semver.inc(prev, "patch");
}

function parseChangedWorkspaces(commits) {
  const changedWorkspaces = new Set();

  commits.forEach((commit) => {
    // kr:, jp:, intl:, bo: 패턴 매칭
    const match = commit.match(/^(kr|jp|intl|bo):/i);
    if (match) {
      changedWorkspaces.add(match[1].toLowerCase());
    }
  });

  return Array.from(changedWorkspaces);
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
  } catch (error) {
    console.warn("Could not fetch workflows:", error.message);
    return [];
  }
}

async function triggerWorkflows(changedWorkspaces, workflows) {
  const triggeredWorkflows = [];

  for (const workspace of changedWorkspaces) {
    const workflowPatterns = WORKFLOW_PATTERNS[workspace] || [];

    for (const pattern of workflowPatterns) {
      const workflow = workflows.find(
        (wf) =>
          wf.name
            .toLowerCase()
            .includes(pattern.replace(".yml", "").toLowerCase()) ||
          wf.path.toLowerCase().includes(pattern.toLowerCase()) ||
          wf.path.includes(
            `deploy-production-${workspace === "bo" ? "backoffice" : workspace}`
          )
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

          // 최근 실행 정보 가져오기 (실제 run URL을 위해)
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

          console.log(
            `✅ Triggered workflow: ${workflow.name} for ${workspace}`
          );
        } catch (error) {
          console.error(
            `❌ Failed to trigger workflow ${workflow.name}:`,
            error.message
          );
        }
      } else {
        console.warn(
          `⚠️  No workflow found for ${workspace} with patterns: ${workflowPatterns.join(
            ", "
          )}`
        );
      }
    }
  }

  return triggeredWorkflows;
}

function generateJiraTemplate(prUrl, triggeredWorkflows, nextVersion) {
  const workspaceGroups = {
    kr: [],
    jp: [],
    intl: [],
    bo: [],
  };

  // 워크플로우를 워크스페이스별로 그룹화
  triggeredWorkflows.forEach((wf) => {
    if (workspaceGroups[wf.workspace]) {
      workspaceGroups[wf.workspace].push(wf);
    }
  });

  let template = `h2. Release v${nextVersion}\n\n`;

  // Backoffice 섹션
  if (workspaceGroups.bo.length > 0) {
    template += `h2. Backoffice\n\n|| |*BO*|\n`;
    template += `||*Pull request*|[${prUrl}|${prUrl}|smart-link]|\n`;
    template += `||*branch*|{{${TARGET_BRANCH}}}|\n`;
    template += `||*Actions*|`;
    workspaceGroups.bo.forEach((wf, index) => {
      if (index > 0) template += " ";
      template += `[${wf.workflowName}|${wf.url}]`;
    });
    template += `|\n\n`;
  }

  // Service 섹션 (기존 Confluence 테이블 형식)
  if (
    workspaceGroups.kr.length > 0 ||
    workspaceGroups.jp.length > 0 ||
    workspaceGroups.intl.length > 0
  ) {
    template += `h2. Service\n\n|| |*KR*|*JP*|*INTL*|\n`;
    template += `||*Pull request*|[${prUrl}|${prUrl}|smart-link]|[${prUrl}|${prUrl}|smart-link]|[${prUrl}|${prUrl}|smart-link]|\n`;
    template += `||*branch*|{{${TARGET_BRANCH}}}|{{${TARGET_BRANCH}}}|{{${TARGET_BRANCH}}}|\n`;
    template += `||*Actions*|`;

    // KR workflows
    if (workspaceGroups.kr.length > 0) {
      workspaceGroups.kr.forEach((wf, index) => {
        if (index > 0) template += "\\n";
        template += `[${wf.workflowName}|${wf.url}]`;
      });
    } else {
      template += "No changes";
    }
    template += `|`;

    // JP workflows
    if (workspaceGroups.jp.length > 0) {
      workspaceGroups.jp.forEach((wf, index) => {
        if (index > 0) template += "\\n";
        template += `[${wf.workflowName}|${wf.url}]`;
      });
    } else {
      template += "No changes";
    }
    template += `|`;

    // INTL workflows
    if (workspaceGroups.intl.length > 0) {
      workspaceGroups.intl.forEach((wf, index) => {
        if (index > 0) template += "\\n";
        template += `[${wf.workflowName}|${wf.url}]`;
      });
    } else {
      template += "No changes";
    }
    template += `|\n\n`;
  }

  return template;
}

async function sendToN8n(jiraTemplate, changedWorkspaces) {
  try {
    const payload = {
      jiraTemplate,
      changedWorkspaces,
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    console.log("✅ Successfully sent to n8n webhook");
    return true;
  } catch (error) {
    console.error("❌ Failed to send to n8n webhook:", error.message);
    return false;
  }
}

async function run() {
  const lastTag = await getLastTag();
  const commits = await getCommitsSince(lastTag);
  const noteMd = await generateReleaseNotes(commits);

  const nextVersion = bumpVersion(
    lastTag.replace(/^v?/, ""),
    commits.join("\n")
  );

  // 변경된 워크스페이스 파싱
  const changedWorkspaces = parseChangedWorkspaces(commits);
  console.log("🔍 Changed workspaces:", changedWorkspaces);

  // GitHub 릴리즈 생성
  await octo.request("POST /repos/{owner}/{repo}/releases", {
    owner: OWNER,
    repo: REPO,
    tag_name: nextVersion,
    name: nextVersion,
    generate_release_notes: true,
  });

  // 릴리즈 브랜치 생성
  const branch = `release/${dayjs().format("YYYY-MM-DD")}`;

  const { data: mainRef } = await octo.request(
    "GET /repos/{owner}/{repo}/git/ref/{ref}",
    {
      owner: OWNER,
      repo: REPO,
      ref: `heads/${BASE_BRANCH}`,
    }
  );

  await octo.request("POST /repos/{owner}/{repo}/git/refs", {
    owner: OWNER,
    repo: REPO,
    ref: `refs/heads/${branch}`,
    sha: mainRef.object.sha,
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  // PR 생성
  const { data: pr } = await octo.request("POST /repos/{owner}/{repo}/pulls", {
    owner: OWNER,
    repo: REPO,
    title: `Release v${nextVersion}`,
    head: branch,
    base: TARGET_BRANCH,
    body: `## v${nextVersion}\n\n${noteMd}\n\n### Changed Workspaces\n${changedWorkspaces
      .map((ws) => `- ${WORKSPACE_MAPPING[ws] || ws}`)
      .join("\n")}`,
  });

  console.log(`✅ Release PR opened for v${nextVersion}: ${pr.html_url}`);

  // 워크플로우 가져오기 및 실행
  if (changedWorkspaces.length > 0) {
    const workflows = await getWorkflows();
    const triggeredWorkflows = await triggerWorkflows(
      changedWorkspaces,
      workflows
    );

    console.log("🚀 Triggered workflows:", triggeredWorkflows);

    // JIRA 템플릿 생성
    const jiraTemplate = generateJiraTemplate(
      pr.html_url,
      triggeredWorkflows,
      nextVersion
    );

    // n8n 웹훅으로 전송
    await sendToN8n(jiraTemplate, changedWorkspaces);
  }

  // Outputs 설정
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
