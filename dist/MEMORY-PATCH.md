# 요약메모리 수정 패치 — 2026-09-11

SDK 2.1.0 반영. [크랙 공식 공지](https://crack.wrtn.ai/announcement/6aa3ce2cfea6fed6669ae47b)와 실제 채팅 페이지가 로드한 빌드 `main-arm64-9ac2473`을 확인했습니다.

## 확인한 동작

- 요약 메모리가 갱신된 뒤 다음 메시지로 진행하기 전까지 단기 기억·관계도·목표를 수정할 수 있습니다.
- 단기 기억·관계도는 삭제도 가능합니다. 목표 삭제는 이번 UI에 제공되지 않습니다.
- 페이지 안내에 따르면 해당 턴 동안 무료이며 수정 횟수 제한이 없습니다.
- 수정 내용은 다음 메시지 답변부터 반영됩니다. 페이지 안내에서는 재생성 답변에는 적용되지 않는다고 설명합니다.
- 다음 메시지 전송 또는 이야기 진행으로 다음 답변이 생성되면 수정 기회가 끝나며 다음 요약 갱신을 기다려야 합니다.
- 상태 기준은 채팅 상세의 `isSummaryFreeEditable`입니다. 서버는 창이 만료된 변경 요청에 403을 반환할 수 있습니다. 클라이언트에서 확인한 상태만으로 저장 성공을 보장할 수 없습니다.

## 실제 요청

| 기능 | 방식·경로 | 인수 |
|---|---|---|
| 종류별 목록 | GET `/crack-gen/v3/chats/:chatId/summaries` | query: `type`, `limit`, `orderBy`, `cursor`/`page`; `filter`는 장기 기억용 |
| 수정 가능 상태 | GET `/crack-gen/v3/chats/:chatId` | 응답 data의 `isSummaryFreeEditable` |
| 단기 기억 수정 | PATCH `/crack-gen/v3/chats/:chatId/summaries/:summaryId` | `{title, summary}` |
| 관계도 수정 | PATCH 동일 경로 | `{title, summary}` |
| 목표 수정 | PATCH 동일 경로 | `{summary}`; title 생략 |
| 단기 기억·관계도 삭제 | DELETE 동일 경로 | body 없음 |

`type`은 목록 조회의 `longTerm`, `shortTerm`, `relationship`, `goal`입니다. 개별 수정/삭제 요청에는 type을 보내지 않습니다. 해당 종류 목록에서 얻은 정확한 `_id`를 사용해야 합니다. 종류별 편의 함수도 서버 항목의 종류를 추가 조회해 검증하지는 않습니다.

페이지 편집 폼 기준 제한을 적용했습니다. 단기 기억은 제목 1~20자·내용 1~300자, 관계도는 제목 1~20자·내용 1~200자, 목표는 내용 1~200자입니다. JavaScript 문자열 length 기준으로 검사합니다.

## 호출 방법

`dist/index.js`를 로드한 환경의 예시입니다. 이 배포 파일은 일반 스크립트이며 전역 `Crack`을 제공합니다.

```js
const api = Crack.createCrackAPI();
const chatId = 'CHAT_ID';

const editable = await api.memory.canEditGenerated(chatId);
const page = await api.memory.list(chatId, {type: 'shortTerm', limit: 20});
// page.summaries: 항목 목록, page.nextCursor: 다음 커서
// UI에서 사용자가 선택한 항목의 _id를 사용합니다.

// 아래 변경 호출은 사용자 저장/삭제 동작에 연결하세요.
// await api.memory.updateShortTerm(chatId, summaryId, {title: '제목', summary: '내용'});
// await api.memory.updateRelationship(chatId, summaryId, {title: '관계', summary: '내용'});
// await api.memory.updateGoal(chatId, summaryId, {summary: '목표 내용'});
// await api.memory.deleteShortTerm(chatId, summaryId);
// await api.memory.deleteRelationship(chatId, summaryId);
```

각 함수의 마지막 options에 `{signal}`을 전달할 수 있습니다. `list()`는 한 페이지만 조회하고 응답 메타데이터를 유지합니다. `canEditGenerated()`는 매번 최신 상태를 조회하며 필드가 없으면 `ResponseError`를 던집니다. 자동 재시도·상태 캐시·수정 기회 우회는 하지 않습니다. 저장 중 403이 발생하면 목록과 수정 가능 상태를 다시 조회하고 편집 UI를 갱신하세요.

기존 `memory.update()`와 `memory.delete()`도 같은 개별 경로를 사용합니다. 새 편의 함수는 종류별 폼 제한과 의도를 명확히 합니다. 일반 delete 함수의 존재는 목표 삭제 지원을 의미하지 않습니다.

**기존 `setShortTerm(chatId, summary)`는 이번 기능과 다릅니다.** 이는 `PUT /summaries`에 `{summary}`를 전달하는 이전 전체 요약 교체 요청입니다. 호환성을 위해 유지했으며 새 개별 기억 편집에는 `updateShortTerm()`을 사용하세요.

## 근거와 검증 범위

- `480-62a8260e24e6d43c.js`: 목록·개별 PATCH/DELETE·이전 PUT 요청 선언. PATCH는 title이 undefined이면 전송하지 않습니다.
- `%5B%5B...chatId%5D%5D-6521a54b7b8aff04.js`: 종류별 편집 폼, 길이 제한, 목표 제목/삭제 제외, `isSummaryFreeEditable` 검사, 403 처리, 수정 안내.
- `_app-f0592e45b5f56e17.js`: characterChat 클라이언트의 `/crack-gen` 접두어.
- 위 파일은 실제 로드된 소스를 브라우저에서 읽어 확인했습니다. 개인 메모리 본문을 배포 자료에 넣지 않았습니다.
- 자동 테스트 59개 통과. 새 요청의 경로·본문·문자수 경계·상태 변화·403 전달·기존 PUT 보존을 검사했습니다.
- 실제 메모리 수정/삭제, 채팅 전송, 유료 생성은 실행하지 않았습니다. 서버 저장 성공을 실측한 결과는 아닙니다.

## GitHub 반영

기존 배포 파일 중 변경된 JavaScript는 `dist/index.js`입니다. 이 문서와 갱신된 README/API-INDEX도 함께 올리면 됩니다. 다른 기능별 번들과 UI 번들의 동작은 변경하지 않았습니다.
