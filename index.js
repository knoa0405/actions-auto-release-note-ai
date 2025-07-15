import { Octokit } from "@octokit/core";
import dayjs from "dayjs";
import semver from "semver";
import OpenAI from "openai";
import fs from "node:fs";
import process from "node:process";
import * as core from "@actions/core";

// 필수 ENV
const GH_TOKEN = process.env.GH_TOKEN;
const OPENAI_API_KEY = core.getInput("openai_api_key");
const OWNER = process.env.GITHUB_REPOSITORY_OWNER;
const REPO = process.env.GITHUB_REPOSITORY.split("/")[1];

const octo = new Octokit({ auth: GH_TOKEN });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

async function getLastTag() {
  const { data } = await octo.request("GET /repos/{owner}/{repo}/tags", {
    owner: OWNER,
    repo: REPO,
    per_page: 1,
  });
  return data[0]?.name ?? "0.0.0";
}

async function getCommitsSince(tag) {
  const { data } = await octo.request(
    "GET /repos/{owner}/{repo}/compare/{basehead}",
    {
      owner: OWNER,
      repo: REPO,
      basehead: `${tag}...main`,
    }
  );
  return data.commits.map((c) => c.commit.message.split("\n")[0]); // subject line only
}

async function generateReleaseNotes(commits) {
  const messages = [
    {
      role: "system",
      content:
        "You are a professional release-note writer. Group commits by type and produce concise, human‑friendly Korean release notes in Markdown bullet lists.",
    },
    { role: "user", content: JSON.stringify(commits) },
  ];

  const chat = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    max_tokens: 400,
  });

  return chat.choices[0].message.content.trim();
}

function bumpVersion(prev, notes) {
  if (/BREAKING|major/i.test(notes)) return semver.inc(prev, "major");
  if (/feat|feature/i.test(notes)) return semver.inc(prev, "minor");
  return semver.inc(prev, "patch");
}

async function run() {
  const lastTag = await getLastTag();
  const commits = await getCommitsSince(lastTag);
  const noteMd = await generateReleaseNotes(commits);
  const nextVersion = bumpVersion(lastTag.replace(/^v?/, ""), noteMd);

  // CHANGELOG.md 덮어쓰기
  fs.writeFileSync("CHANGELOG.md", `## v${nextVersion}\n\n${noteMd}\n`, {
    flag: "a", // append
  });

  // 릴리스 브랜치 + PR
  const branch = `release/${dayjs().format("YYYY-MM-DD")}`;
  const { data: mainRef } = await octo.request(
    "GET /repos/{owner}/{repo}/git/ref/{ref}",
    {
      owner: OWNER,
      repo: REPO,
      ref: "heads/main",
    }
  );

  await octo.request("POST /repos/{owner}/{repo}/git/refs", {
    owner: OWNER,
    repo: REPO,
    ref: `refs/heads/${branch}`,
    sha: mainRef.object.sha,
  });

  await octo.request("POST /repos/{owner}/{repo}/pulls", {
    owner: OWNER,
    repo: REPO,
    title: `Release v${nextVersion}`,
    head: branch,
    base: "main",
    body: `## v${nextVersion}\n\n${noteMd}`,
  });

  console.log(`✅ Release PR opened for v${nextVersion}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
