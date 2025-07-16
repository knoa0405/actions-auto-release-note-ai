import { Octokit } from "@octokit/core";
import dayjs from "dayjs";
import semver from "semver";
import OpenAI from "openai";
import process from "node:process";

// 필수 ENV
const OWNER = process.env.GITHUB_REPOSITORY_OWNER;
const REPO = process.env.GITHUB_REPOSITORY.split("/")[1];
const OPENAI_API_KEY = process.env.INPUT_OPENAI_API_KEY;
const GH_TOKEN = process.env.INPUT_GITHUB_TOKEN;

const octo = new Octokit({ auth: GH_TOKEN });
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

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

async function run() {
  const lastTag = await getLastTag();
  const commits = await getCommitsSince(lastTag);
  const noteMd = await generateReleaseNotes(commits);

  const nextVersion = bumpVersion(
    lastTag.replace(/^v?/, ""),
    commits.join("\n")
  );

  await octo.request("POST /repos/{owner}/{repo}/releases", {
    owner: OWNER,
    repo: REPO,
    tag_name: nextVersion,
    name: nextVersion,
    generate_release_notes: true,
  });

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
    headers: {
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  await octo.request("POST /repos/{owner}/{repo}/pulls", {
    owner: OWNER,
    repo: REPO,
    title: `Release v${nextVersion}`,
    head: branch,
    base: "production",
    body: `## v${nextVersion}\n\n${noteMd}`,
  });

  console.log(`✅ Release PR opened for v${nextVersion}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
