import dayjs from "dayjs";
import semver from "semver";
import fs from "node:fs";
import { OWNER, REPO, BASE_BRANCH, TARGET_BRANCH } from "../config/environment.js";
import { octo, getLastTag, getMergedPRsSince, } from "../github/octokit.js";
import { generateReleaseNotes } from "../ai/openai-client.js";
export function bumpVersion(prev, prs) {
    if (/BREAKING|major/i.test(prs))
        return semver.inc(prev, "major") || prev;
    if (/feat|feature/i.test(prs))
        return semver.inc(prev, "minor") || prev;
    return semver.inc(prev, "patch") || prev;
}
export async function createRelease() {
    const lastTag = await getLastTag();
    const { mergedPRs } = await getMergedPRsSince(lastTag);
    const nextVersion = bumpVersion(lastTag.replace(/^v?/, ""), mergedPRs.map((pr) => pr.title).join("\n")) || "0.0.1";
    // 모든 PR에서 변경된 워크스페이스 수집
    const allChangedWorkspaces = new Set();
    mergedPRs.forEach((pr) => {
        pr.changedFolders.forEach((folder) => allChangedWorkspaces.add(folder));
    });
    const changedWorkspaces = Array.from(allChangedWorkspaces);
    const noteMd = await generateReleaseNotes(mergedPRs, changedWorkspaces);
    const branch = `release/${dayjs().format("YYYY-MM-DD-HHmmss")}-v${nextVersion}`;
    const { data: mainRef } = await octo.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
        owner: OWNER,
        repo: REPO,
        ref: `heads/${BASE_BRANCH}`,
    });
    // 태그 생성
    await octo.request("POST /repos/{owner}/{repo}/git/refs", {
        owner: OWNER,
        repo: REPO,
        ref: `refs/tags/v${nextVersion}`,
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
    // PR 생성
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
    console.log(`✅ Release PR opened for v${nextVersion}: ${pr.html_url}`);
    if (process.env["GITHUB_OUTPUT"]) {
        fs.appendFileSync(process.env["GITHUB_OUTPUT"], `pr_url=${pr.html_url}\ndeployed_workspaces=${changedWorkspaces.join(",")}\n`);
    }
}
