# 🚀 Auto Release Note AI Action

AI 기반 자동 릴리즈 노트 생성 및 워크스페이스별 배포 관리를 위한 GitHub Action입니다.

## ✨ 주요 기능

- **🤖 AI 릴리즈 노트 생성**: OpenAI GPT를 사용하여 커밋 메시지를 한국어 릴리즈 노트로 자동 변환
- **📦 스마트 버전 관리**: 커밋 메시지를 분석하여 Semantic Versioning 자동 적용
- **🎯 워크스페이스 감지**: 커밋 prefix로 변경된 워크스페이스 자동 파싱 (`kr:`, `jp:`, `intl:`, `bo:`)
- **⚡ 자동 워크플로우 실행**: 변경된 워크스페이스에 해당하는 배포 워크플로우만 선택적 실행
- **📋 JIRA 템플릿 생성**: 배포 정보를 JIRA Confluence 형식으로 자동 생성
- **🔗 n8n 웹훅 연동**: 배포 알림을 n8n 워크플로우로 자동 전송

## 🏗️ 워크스페이스 구조

이 Action은 다음 4가지 워크스페이스를 지원합니다:

| Prefix  | 워크스페이스      | 설명          |
| ------- | ----------------- | ------------- |
| `kr:`   | coloso-kr         | 한국 서비스   |
| `jp:`   | coloso-jp         | 일본 서비스   |
| `intl:` | coloso-intl       | 글로벌 서비스 |
| `bo:`   | coloso-backoffice | 백오피스      |

### 커밋 메시지 예시

```
kr: 결제 모듈 버그 수정
jp: 언어 설정 개선
intl: 글로벌 결제 게이트웨이 추가
bo: 관리자 대시보드 UI 개선
```

## ⚙️ 사용법

### Workflow 파일 예시

```yaml
name: Auto Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Create Release PR
        uses: your-org/actions-auto-release-note-ai@v1
        with:
          openai_api_key: ${{ secrets.OPENAI_API_KEY }}
          github_token: ${{ secrets.GITHUB_TOKEN }}
          base_branch: "main"
          target_branch: "production"
          n8n_webhook_url: ${{ secrets.N8N_WEBHOOK_URL }}
```

### 필수 입력 파라미터

| 파라미터          | 설명          | 필수 |
| ----------------- | ------------- | ---- |
| `openai_api_key`  | OpenAI API 키 | ✅   |
| `github_token`    | GitHub 토큰   | ✅   |
| `n8n_webhook_url` | n8n 웹훅 URL  | ✅   |

### 선택 입력 파라미터

| 파라미터        | 설명        | 기본값       |
| --------------- | ----------- | ------------ |
| `base_branch`   | 소스 브랜치 | `main`       |
| `target_branch` | 타겟 브랜치 | `production` |

## 🔄 작업 흐름

1. **커밋 분석**: 마지막 태그 이후의 모든 커밋 메시지 수집
2. **워크스페이스 파싱**: 커밋 prefix로 변경된 워크스페이스 감지
3. **버전 계산**: Semantic Versioning 규칙에 따라 새 버전 계산
4. **AI 릴리즈 노트**: OpenAI로 한국어 릴리즈 노트 생성
5. **GitHub 릴리즈**: 새 태그와 릴리즈 페이지 자동 생성
6. **PR 생성**: `release/YYYY-MM-DD` 브랜치로 PR 생성
7. **워크플로우 실행**: 변경된 워크스페이스의 배포 워크플로우 트리거
8. **JIRA 템플릿**: 배포 정보를 JIRA 형식으로 구성
9. **n8n 알림**: 웹훅으로 배포 정보 전송

## 📊 출력값

| 출력                  | 설명                                 |
| --------------------- | ------------------------------------ |
| `pr_url`              | 생성된 Pull Request URL              |
| `deployed_workspaces` | 배포될 워크스페이스 목록 (쉼표 구분) |

## 🎯 워크플로우 매핑

Action은 다음 패턴으로 배포 워크플로우를 자동 매핑합니다:

```javascript
const WORKFLOW_PATTERNS = {
  kr: ["deploy-production-kr.yml"],
  jp: ["deploy-production-jp.yml"],
  intl: [
    "deploy-production-intl-asia.yml",
    "deploy-production-intl-us.yml",
    "deploy-production-intl-us-east.yml",
  ],
  bo: ["deploy-production-backoffice.yml"],
};
```

## 📋 JIRA 템플릿 출력 예시

```confluence
h2. Release v1.2.3

h2. Backoffice

|| |*BO*|
||*Pull request*|[https://github.com/org/repo/pull/123|https://github.com/org/repo/pull/123|smart-link]|
||*branch*|{{production}}|
||*Actions*|[Deploy Production Backoffice|https://github.com/org/repo/actions/runs/123456]|

h2. Service

|| |*KR*|*JP*|*INTL*|
||*Pull request*|[PR Link|PR Link|smart-link]|[PR Link|PR Link|smart-link]|[PR Link|PR Link|smart-link]|
||*branch*|{{production}}|{{production}}|{{production}}|
||*Actions*|[Deploy Production KR|workflow-url]|No changes|[Deploy Production INTL ASIA|workflow-url]\n[Deploy Production INTL-US|workflow-url]|
```

## 🔐 필요한 권한

### GitHub Token 권한

- `contents: write` - 릴리즈 생성
- `pull-requests: write` - PR 생성
- `actions: write` - 워크플로우 실행

### Secrets 설정

```
OPENAI_API_KEY=sk-...
N8N_WEBHOOK_URL=https://your-n8n-instance.com/webhook/...
```

## 🚨 버전 관리 규칙

| 커밋 메시지 패턴    | 버전 타입             | 예시                          |
| ------------------- | --------------------- | ----------------------------- |
| `BREAKING`, `major` | Major (1.0.0 → 2.0.0) | `BREAKING: API 스키마 변경`   |
| `feat`, `feature`   | Minor (1.0.0 → 1.1.0) | `feat: 새로운 결제 모듈 추가` |
| 기타                | Patch (1.0.0 → 1.0.1) | `fix: 로그인 버그 수정`       |

## 🔧 개발자 가이드

### 로컬 테스트

```bash
npm install
node index.js
```

### 환경변수 설정

```bash
export GITHUB_REPOSITORY_OWNER=your-org
export GITHUB_REPOSITORY=your-org/your-repo
export INPUT_OPENAI_API_KEY=sk-...
export INPUT_GITHUB_TOKEN=ghp_...
export INPUT_N8N_WEBHOOK_URL=https://...
```

## 📄 라이선스

MIT License
