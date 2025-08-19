import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/environment";
export const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
export async function generateReleaseNotes(commits, changedWorkspaces) {
    const messages = [
        {
            role: "system",
            content: `
You are a professional release-note writer. Analyze the provided commits and create structured Korean release notes.

**Input Format:**
Each commit includes:
- message: 커밋 메시지
- changedFolders: 변경된 폴더 목록 (예: ["coloso-backoffice", "coloso-kr"])
- changedWorkspaces: 변경된 워크스페이스 목록 (예: ["coloso-backoffice", "coloso-kr"])

**Instructions:**
- Analyze each commit based on its message AND changed folders
- Use these categories:
   - Backoffice: changedFolders에 'coloso-backoffice'가 포함된 커밋들
   - Service: KR: changedFolders에 'coloso-kr'가 포함된 커밋들  
   - Service: JP: changedFolders에 'coloso-jp'가 포함된 커밋들
   - Service: INTL: changedFolders에 'coloso-intl'가 포함된 커밋들

**Analysis Rules:**
1. 각 커밋을 해당하는 워크스페이스 카테고리로 분류
2. 커밋 메시지의 내용을 분석하여 New Features/Bug Fixes/Improvements로 세분화
3. 같은 커밋이 여러 워크스페이스에 영향을 준다면 각각에 포함
4. 워크스페이스별로 변경사항을 그룹화하여 정리

**Output Format:**
각 워크스페이스별로:

## Backoffice

### 🚀 New Features
- 사용자 인증 기능 추가

### 🐛 Bug Fixes
- 로그인 오류 수정 

## Service: KR

### 🔧 Improvements
- 성능 최적화

**Note:** 
- 각 커밋의 실제 내용과 변경된 폴더를 모두 고려하여 분류
- 한국어로 자연스럽게 작성
- 내용이 없으면 해당 분류는 생략
- changedWorkspaces가 하나도 없으면 Chore 카테고리로 분류
`,
        },
        {
            role: "user",
            content: JSON.stringify({
                commits,
                changedWorkspaces,
            }),
        },
    ];
    const chat = await openai.chat.completions.create({
        model: "gpt-4.1-mini",
        messages,
        max_tokens: 1000,
    });
    return chat.choices[0].message.content?.trim() || "";
}
