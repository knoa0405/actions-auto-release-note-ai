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
export async function getMergedPRsSince(tag) {
    try {
        // 태그의 생성 날짜 가져오기
        const { data: tagData } = await octo.request("GET /repos/{owner}/{repo}/git/refs/tags/{tag}", {
            owner: OWNER,
            repo: REPO,
            tag: tag,
        });
        const { data: tagObject } = await octo.request("GET /repos/{owner}/{repo}/git/tags/{tag_sha}", {
            owner: OWNER,
            repo: REPO,
            tag_sha: tagData.object.sha,
        });
        // 태그 이후에 머지된 PR들을 base와 since 파라미터로 가져오기
        const { data: prs } = await octo.request("GET /repos/{owner}/{repo}/pulls", {
            owner: OWNER,
            repo: REPO,
            state: "closed",
            base: BASE_BRANCH, // 메인 브랜치를 타겟으로 하는 PR들
            sort: "updated",
            direction: "desc",
            per_page: 100,
        });
        // 태그 날짜 이후에 머지된 PR들만 필터링
        const tagDate = new Date(tagObject.tagger.date);
        const relevantPRs = prs.filter((pr) => pr.merged_at && new Date(pr.merged_at) > tagDate);
        // 각 PR의 변경된 파일들 확인
        const prsWithFiles = await Promise.all(relevantPRs.map(async (pr) => {
            const { data: files } = await octo.request("GET /repos/{owner}/{repo}/pulls/{pull_number}/files", {
                owner: OWNER,
                repo: REPO,
                pull_number: pr.number,
            });
            // 변경된 폴더 추출
            const changedFolders = new Set();
            const fileNames = files.map((file) => file.filename);
            fileNames.forEach((filename) => {
                if (filename.includes("/")) {
                    const folder = filename.split("/")[0];
                    if (folder.startsWith("coloso-")) {
                        changedFolders.add(folder);
                    }
                }
            });
            return {
                number: pr.number,
                title: pr.title,
                description: pr.body || "",
                changedFolders: Array.from(changedFolders),
                files: fileNames,
                htmlUrl: pr.html_url,
            };
        }));
        return {
            mergedPRs: prsWithFiles,
        };
    }
    catch (error) {
        console.error("❌ Error getting merged PRs:", error);
        return {
            mergedPRs: [],
        };
    }
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
