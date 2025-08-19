import { N8N_URL } from "../config/environment.js";
const sendToN8n = async (jiraTemplate, changedWorkspaces) => {
    if (!N8N_URL) {
        console.log("N8N_URL not provided, skipping n8n notification");
        return false;
    }
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("❌ Failed to send to n8n webhook:", message);
        return false;
    }
};
export default sendToN8n;
