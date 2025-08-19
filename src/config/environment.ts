import process from "node:process";

export const OWNER = process.env.GITHUB_REPOSITORY_OWNER!;
export const REPO = process.env.GITHUB_REPOSITORY!.split("/")[1];
export const OPENAI_API_KEY = process.env.INPUT_OPENAI_API_KEY!;
export const GH_TOKEN = process.env.INPUT_GITHUB_TOKEN!;
export const BASE_BRANCH = process.env.INPUT_BASE_BRANCH || "main";
export const TARGET_BRANCH = process.env.INPUT_TARGET_BRANCH || "production";
export const N8N_URL = process.env.INPUT_N8N_URL;
export const MODE = process.env.INPUT_MODE || "both";
