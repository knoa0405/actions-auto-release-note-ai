import { OWNER, REPO, TARGET_BRANCH } from "../config/environment";
import { octo } from "../github/octokit";
export function generateWorkflowPatterns(workspaces) {
    const patterns = {};
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
export async function triggerWorkflows(changedWorkspaces, workflows, workflowPatterns) {
    const triggeredWorkflows = [];
    for (const workspace of changedWorkspaces) {
        const patterns = workflowPatterns[workspace] || [];
        for (const pattern of patterns) {
            const workflow = workflows.find((workflow) => workflow.name
                .toLowerCase()
                .includes(pattern.replace(".yml", "").toLowerCase()) ||
                workflow.path.toLowerCase().includes(pattern.toLowerCase()));
            if (workflow) {
                try {
                    await octo.request("POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches", {
                        owner: OWNER,
                        repo: REPO,
                        workflow_id: workflow.id,
                        ref: TARGET_BRANCH,
                    });
                    const { data: runs } = await octo.request("GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs", {
                        owner: OWNER,
                        repo: REPO,
                        workflow_id: workflow.id,
                        per_page: 1,
                    });
                    const runUrl = runs.workflow_runs[0]
                        ? runs.workflow_runs[0].html_url
                        : `https://github.com/${OWNER}/${REPO}/actions/workflows/${workflow.path}`;
                    triggeredWorkflows.push({
                        workspace,
                        workflowName: workflow.name,
                        workflowId: workflow.id,
                        url: runUrl,
                    });
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    console.error(`❌ Failed to trigger workflow ${workflow.name}:`, message);
                }
            }
            else {
                console.warn(`⚠️  No workflow found for ${workspace} with patterns: ${patterns.join(", ")}`);
            }
        }
    }
    return triggeredWorkflows;
}
