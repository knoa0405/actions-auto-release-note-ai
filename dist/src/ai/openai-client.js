import OpenAI from "openai";
import { OPENAI_API_KEY } from "../config/environment.js";
export const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
export async function generateReleaseNotes(mergedPRs, changedWorkspaces) {
    const messages = [
        {
            role: "system",
            content: `
You are a professional release-note writer. Analyze the provided merged pull requests and create structured Korean release notes.

**Input Format:**
Each PR includes:
- number: PR 번호
- title: PR 제목
- description: PR 설명
- changedFolders: 변경된 폴더 목록 (예: ["coloso-backoffice", "coloso-kr"])
- files: 변경된 파일 목록
- htmlUrl: PR URL

**Instructions:**
- Analyze each PR based on its title, description AND changed folders
- Use these categories:
   - Backoffice: changedFolders에 'coloso-backoffice'가 포함된 PR들
   - Service: KR: changedFolders에 'coloso-kr'가 포함된 PR들  
   - Service: JP: changedFolders에 'coloso-jp'가 포함된 PR들
   - Service: INTL: changedFolders에 'coloso-intl'가 포함된 PR들

**Analysis Rules:**
1. 각 PR을 해당하는 워크스페이스 카테고리로 분류
2. PR 제목과 설명을 분석하여 New Features/Bug Fixes/Improvements로 세분화
3. 각 PR description 에 있는 내용을 1줄로 요약해 '- [PR 번호]' 아래 항목으로 추가
4. 같은 PR이 여러 워크스페이스에 영향을 준다면 각각에 포함
5. 워크스페이스별로 변경사항을 그룹화하여 정리

**Output Format:**
각 워크스페이스별로:

## Backoffice

### 🚀 New Features
- [PR #123] 
  - 데이터 조회 기능 추가  

### 🐛 Bug Fixes
- [PR #124] 
  - 로그인 오류 수정 

## Service: KR

### 🔧 Improvements
- [PR #125] 
  - 성능 최적화

**Note:** 
- 각 PR의 실제 내용과 변경된 폴더를 모두 고려하여 분류
- 한국어로 자연스럽게 작성
- 내용이 없으면 해당 분류는 생략
- changedWorkspaces가 하나도 없으면 Chore 카테고리로 분류
- PR 번호를 포함하여 추적 가능하도록 작성
`,
        },
        {
            role: "user",
            content: JSON.stringify({
                mergedPRs,
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
