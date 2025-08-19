import { Octokit } from "@octokit/core";
import { OWNER, REPO, GH_TOKEN, BASE_BRANCH } from "../config/environment.js";
import fs from "node:fs";
export const octo = new Octokit({ auth: GH_TOKEN });
export async function getWorkspacesFromRepo() {
    try {
        const { data } = await octo.request("GET /repos/{owner}/{repo}/contents", {
            owner: OWNER,
            repo: REPO,
            path: "",
        });
        const workspaces = data
            .filter((item) => item.type === "dir" && item.name.startsWith("coloso-"))
            .map((item) => item.name);
        return workspaces;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("Could not fetch workspaces from repo:", message);
        return [];
    }
}
export async function getLastTag() {
    try {
        const { data: releases } = await octo.request("GET /repos/{owner}/{repo}/releases", {
            owner: OWNER,
            repo: REPO,
            per_page: 1,
        });
        if (releases.length > 0 && releases[0].tag_name) {
            return releases[0].tag_name;
        }
        throw new Error("No release notes found to get last tag");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("❌ Error getting last tag:", message);
        return "0.0.0";
    }
}
export async function getCommitsSince(tag) {
    const { data } = await octo.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        owner: OWNER,
        repo: REPO,
        basehead: `${tag}...${BASE_BRANCH}`,
    });
    // 각 커밋별로 변경된 폴더 정보 매핑
    const commitsWithFolders = data.commits.map((commit) => {
        const changedFolders = new Set();
        // 해당 커밋 이후의 파일 변경사항에서 폴더 추출
        (data.files || []).forEach((file) => {
            if (file.filename.includes("/")) {
                const folder = file.filename.split("/")[0];
                if (folder.startsWith("coloso-")) {
                    changedFolders.add(folder);
                }
            }
        });
        return {
            message: commit.commit.message.split("\n")[0], // subject line only
            changedFolders: Array.from(changedFolders),
        };
    });
    return {
        commits: commitsWithFolders,
        files: data.files || [],
    };
}
export async function getWorkflows() {
    try {
        const { data } = await octo.request("GET /repos/{owner}/{repo}/actions/workflows", {
            owner: OWNER,
            repo: REPO,
        });
        return data.workflows;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("Could not fetch workflows:", message);
        return [];
    }
}
export async function getChangedWorkspacesFromPR() {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (!eventPath) {
        console.log("GITHUB_EVENT_PATH not available, using all workspaces");
        return {
            workspaces: await getWorkspacesFromRepo(),
            prUrl: "",
            version: "current",
        };
    }
    try {
        const eventData = JSON.parse(fs.readFileSync(eventPath, "utf8"));
        const pr = eventData.pull_request;
        if (pr && pr.merged) {
            console.log(`🔍 Analyzing merged PR #${pr.number}`);
            // 머지된 PR의 변경사항 가져오기
            const { data } = await octo.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
                owner: OWNER,
                repo: REPO,
                pull_number: pr.number,
            });
            const changedWorkspaces = data
                .map((file) => file.filename)
                .filter((filename) => filename.includes("coloso-"))
                .map((filename) => filename.split("/")[0]);
            const uniqueWorkspaces = [...new Set(changedWorkspaces)];
            console.log(`🔍 PR #${pr.number} changed workspaces: ${uniqueWorkspaces.join(", ")}`);
            // PR 제목에서 버전 정보 추출
            const versionMatch = pr.title.match(/Release v(\d+\.\d+\.\d+)/);
            const version = versionMatch ? versionMatch[1] : "current";
            console.log(`🔍 Extracted version: ${version}`);
            return {
                workspaces: uniqueWorkspaces,
                prUrl: pr.html_url,
                version: version,
            };
        }
        console.log("PR not merged, using all workspaces");
        return {
            workspaces: await getWorkspacesFromRepo(),
            prUrl: "",
            version: "current",
        };
    }
    catch (error) {
        console.warn("Could not parse event data, using all workspaces:", error);
        return {
            workspaces: await getWorkspacesFromRepo(),
            prUrl: "",
            version: "current",
        };
    }
}
export async function getChangedWorkspaces(files) {
    const changedWorkspaces = files.map((file) => {
        if (file.filename.includes("coloso-")) {
            return file.filename.split("/")[0];
        }
        return null;
    });
    return changedWorkspaces.filter((ws) => ws !== null);
}
