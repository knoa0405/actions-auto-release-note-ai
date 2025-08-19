import { TARGET_BRANCH } from "../config/environment";
import type { TriggeredWorkflow } from "../types";

export function generateJiraTemplate(
  releaseUrl: string,
  prUrl: string,
  triggeredWorkflows: TriggeredWorkflow[],
  nextVersion: string,
  workspaces: string[]
): string {
  const workspaceGroups: Record<string, TriggeredWorkflow[]> = {};

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
  template += `*Release:* [${releaseUrl}|${releaseUrl}|smart-link]\n`;
  template += `*Pull Request:* [${prUrl}|${prUrl}|smart-link]\n`;
  template += `*Branch:* {{${TARGET_BRANCH}}}\n\n`;

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
