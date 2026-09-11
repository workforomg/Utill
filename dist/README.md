# Crack SDK

크랙 웹 기능을 JavaScript 프로젝트나 브라우저 확장 기능에서 사용할 수 있도록 정리한 비공식 SDK입니다. 크랙 API를 호출하는 **Core**와 페이지 요소를 찾고 조작하는 **UI**를 각각 독립적으로 사용할 수 있습니다.

- 외부 런타임 패키지와 CDN 의존성이 없습니다.
- 이 폴더는 브라우저용 독립 번들을 제공합니다. 각 파일은 일반 스크립트로 로드합니다.
- API 객체 생성이나 파일 로드만으로 요청·채팅 전송을 시작하지 않습니다.
- 기능별 파일에 경로와 UI 탐색 규칙을 모아 사이트 변경에 대응합니다.

버전: **2.1.0** · 사이트 확인 기준: **2026-09-11**

## 2.1.0 업데이트

단기 기억·관계도·목표의 개별 수정, 단기 기억·관계도 삭제, 수정 가능 상태 조회를 지원합니다. 요약 갱신 후 다음 메시지로 진행하기 전까지만 수정할 수 있습니다. [호출 방법과 정확한 패치 내용](MEMORY-PATCH.md)을 확인하세요.

## 시작하기

필요한 파일만 로드하세요. `index.js`는 API 전체를 포함하고, `ui.js`는 별도 화면 도구입니다. 기능별 API 번들을 사용하면 `index.js`를 함께 로드할 필요가 없습니다.

| 파일 | 전역 객체 | 용도 |
|---|---|---|
| [index.js](index.js) | `Crack` | Core API 전체 |
| [ui.js](ui.js) | `CrackUI` | UI 탐색·연결 도구 |
| [discovery.js](discovery.js) | `CrackDiscovery` | 검색·탐색 |
| [profiles.js](profiles.js) | `CrackProfiles` | 프로필·설정 |
| [community.js](community.js) | `CrackCommunity` | 공지·알림·피드 조회 |
| [library.js](library.js) | `CrackLibrary` | 작품·채팅 목록 |

### 프로젝트에서 로드

파일을 프로젝트의 `dist/`에 복사한 경우:

```html
<script src="./dist/index.js"></script>
<script src="./dist/ui.js"></script>
<script>
  const api = Crack.createCrackAPI();
  const ui = CrackUI.createPageUI();
</script>
```

이 파일들은 named export를 제공하는 ES 모듈이 아닙니다. `import {createCrackAPI} from './dist/index.js'`처럼 사용하지 마세요. `core/`, `ui/` 하위 소스 폴더도 이 배포본에는 없습니다.

### Tampermonkey에서 로드

유저스크립트 헤더의 `@require`에 GitHub Raw 주소를 넣습니다. 아래 코드는 API 객체만 생성하며 서버 요청은 하지 않습니다.

```js
// ==UserScript==
// @name         SDK 사용 예제
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/index.js
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(() => {
  const api = Crack.createCrackAPI();
  // 사용자가 누르는 버튼 등에 API 호출을 연결하세요.
})();
```

UI가 필요하면 `ui.js`의 Raw 주소도 `@require`로 추가합니다. 파일명에서 접두사만 제거했으므로 전역 이름은 `Crack`, `CrackUI` 등을 유지합니다.

다른 확장 기능을 배포할 때는 `main` 대신 검증한 커밋 해시로 Raw 주소를 고정하면 업데이트 시점을 직접 관리할 수 있습니다. 자동으로 항상 최신 파일이 로드된다고 가정하지 마세요.

아래 API 예제는 `index.js`가 로드된 환경을 기준으로 하며, `await`는 async 함수 안에서 사용합니다.

## 실행 환경과 인증

API 호출은 로그인된 크랙 페이지처럼 인증과 API 접근이 가능한 환경에서 사용합니다. 기본 요청기는 요청할 때마다 읽을 수 있는 `access_token` 쿠키를 확인하고 `credentials: include`를 사용합니다.

확장 기능의 격리된 실행 영역이나 다른 사이트에서는 인증·CORS 조건이 다를 수 있습니다. SDK가 브라우저 접근 제한을 자동 해제하거나 토큰을 갱신하지는 않습니다. 호출 환경에 맞는 `token`, `fetch` 또는 `request`를 주입할 수 있습니다.

| 공통 옵션 | 기본값 / 역할 |
|---|---|
| `baseURL` | `https://crack-api.wrtn.ai` |
| `timeout` | `30000`ms. `0`이면 HTTP 타임아웃 없음 |
| `token` | 토큰 문자열을 반환하는 함수. 기본은 쿠키 조회 |
| `fetch` | `globalThis.fetch`를 사용하는 요청 함수 |
| `request` | `async (path, options) => response` 형태의 사용자 요청기. 지정하면 기본 전송기를 대체 |

```js
const community = Crack.createCommunityAPI({timeout: 10000});
```

API 래퍼는 응답에 `data` 필드가 있으면 해당 값을 반환하고, 없으면 원본 응답을 반환합니다. 기본 요청기와 `api.request()`는 전체 응답을 반환합니다.

## 주요 API

| 생성 함수 | 제공 기능 |
|---|---|
| `createCrackAPI()` | 채팅·메시지·요약 메모리·작품·초안·서버 유저노트·출석·잔액·모델·이미지 업로드 요청 |
| `createDiscoveryAPI()` | 통합 검색·콘텐츠/계정/시리즈/태그 검색·검색어·홈 구성 |
| `createProfilesAPI()` | 내 프로필·사용자 프로필·팔로우·대화 프로필·개인 맞춤 설정·배지·차단 목록 |
| `createCommunityAPI()` | 공지·알림·피드·댓글 조회 |
| `createLibraryAPI()` | 내 작품·좋아요·구독 시리즈·스토리/캐릭터 목록·채팅 보관함 |
| `createChatSession()` | 채팅 소켓 연결·이벤트 구독·전송·재생성·이어쓰기 |

공지·검색·프로필·작품 목록의 세부 경로와 확인 근거는 [API 목록](API-INDEX.md)을 참고하세요. 피드 작성 함수는 제공하지 않습니다.

### 검색과 프로필 조회

```js
const {createDiscoveryAPI, createProfilesAPI} = Crack;

const discovery = createDiscoveryAPI();
const profiles = createProfilesAPI();

const searchResult = await discovery.search({
  query: {keyword: '판타지'},
});

const followers = await profiles.followers({
  profileId: 'PROFILE_ID',
  query: {limit: 20},
});
```

신규 기능 모듈은 `함수({경로 변수, query, body}, {signal})` 형식을 사용합니다. 조회 조건은 `query`, 변경할 데이터는 `body` 안에 넣습니다. 경로 변수는 비어 있지 않은 문자열이어야 합니다. GET 요청에는 `body`를 넣을 수 없습니다.

한 번 호출하면 한 번 요청합니다. 다음 페이지가 필요하면 응답의 페이지/커서 정보를 사용해 다시 호출하세요.

### 요청 전 경로 확인

```js
const requestInfo = profiles.describe('followers', {
  profileId: 'PROFILE_ID',
  query: {limit: 20},
});

// 실제 요청 없이 method, path, query, effect, evidence 등을 확인합니다.
console.log(requestInfo.method, requestInfo.path);
```

`metadata`는 함수별 요청 정의를, `describe()`는 인수를 적용한 요청 정보를 제공합니다. `effect`는 설명용 값이며 HTTP 변경 요청을 차단하지 않습니다.

### 메시지와 서버 유저노트

기존 채팅 API는 `함수(id, options)`처럼 위치 인수를 사용합니다.

```js
const {createCrackAPI} = Crack;
const api = createCrackAPI();

const chat = await api.chat.get('CHAT_ID');
const userNote = await api.userNote.get('CHAT_ID');

// 최대 20개까지만 조회합니다.
for await (const message of api.chat.messages('CHAT_ID', {max: 20, limit: 20})) {
  // 필요한 처리를 작성하세요.
}

// 실행하면 크랙 서버의 유저노트를 수정합니다.
// await api.userNote.set('CHAT_ID', '기억할 내용', {isExtend: false});
```

`api.userNote`는 크랙 채팅에 저장되는 유저노트입니다. 일반 유저노트는 500자 제한을 검사하며, 확장 사용 여부는 `isExtend`로 전달합니다.

메시지·메모리 순회에는 `max`, `limit`, `delay`, `signal`, `query`를 지정할 수 있습니다. `max: -1`은 전체, `max: 0`은 요청 없음, `limit`은 1~100입니다. `api.chat.export()`는 메시지를 배열로 수집하는 SDK 편의 함수이며 별도 서버 export API는 아닙니다.

### 취소와 오류 처리

```js
const community = Crack.createCommunityAPI();
const controller = new AbortController();

try {
  const result = await community.announcements(
    {query: {page: 1, limit: 20}},
    {signal: controller.signal},
  );
} catch (error) {
  if (error.name === 'HttpError') {
    console.error('HTTP 상태:', error.status);
  } else {
    console.error('요청 실패:', error.name);
  }
}

// 진행 중인 요청을 취소할 때 호출합니다.
// controller.abort();
```

`HttpError`는 실패한 HTTP 상태를, `ResponseError`는 예상과 다른 JSON/페이지 응답을 나타냅니다. 취소와 타임아웃도 예외로 전달됩니다. HTTP 요청을 자동 재시도하지 않습니다.

### 채팅 소켓

```js
const {createChatSession} = Crack;

const session = createChatSession({chatId: 'CHAT_ID', kind: 'story'});
const unsubscribe = session.on('characterMessageGenerated', event => {
  // 생성 완료 이벤트 처리
});

// 연결할 때 명시적으로 실행합니다.
// await session.connect();
// 전송·재생성 등은 사용자가 요청한 동작에 연결하세요.
// await session.send('메시지');

// 사용을 마친 뒤 정리합니다.
unsubscribe();
session.close();
```

`kind`는 `story` 또는 `character`입니다. 명령은 `connect()` 완료 후 사용합니다. 명령의 ACK는 요청 수락을 뜻하며 생성 완료와 다릅니다. 자동 재연결이나 명령 재전송은 하지 않습니다. 전송·재생성·이어쓰기 등 생성 명령은 크래커를 사용할 수 있습니다.

## UI 사용하기

UI 모듈은 페이지의 버튼·입력창·컨테이너를 의미 있는 키로 찾습니다. 이 모듈에는 DOM 연결과 SDK용 패널 삽입 도구가 포함되며, 자체 서버 API는 없습니다.

```js
const {createPageUI} = CrackUI;

const ui = createPageUI();
const report = ui.inspect('search.input');

if (report.status === 'found') {
  const input = ui.element('search.input');
  // 찾은 입력 요소를 사용합니다.
}

const stopWatching = ui.watch(reports => {
  // 페이지 전환·DOM 변경 이후 요소 상태 확인
});

// 확장 기능을 종료할 때 호출합니다.
stopWatching();
```

| 메서드 | 역할 |
|---|---|
| `inspect(key)` | 요소 존재·중복·페이지 등의 진단 |
| `element(key)` | 하나로 확인된 요소 반환. 실패 시 예외 |
| `elements(key)` | 목록 요소 반환 |
| `click(key)` | 새로 찾은 단일 버튼 클릭 |
| `health(keys?)` | 여러 키의 진단 목록 |
| `watch(callback)` | DOM/페이지 변화 감시. 해제 함수 반환 |
| `configure(key, definition)` | 현재 인스턴스의 키 정의 교체 |

기본 클릭은 `navigate`와 `local` 효과만 허용합니다. 여러 후보가 있거나 대상이 가려져 있으면 클릭을 중단합니다. 클릭 성공은 화면의 처리 완료를 보장하지 않습니다.

사이트 패치로 요소가 바뀌면 인스턴스의 `configure()`로 해당 정의를 교체하세요. 정의된 105개 키가 모든 화면에서 검증된 것은 아닙니다. 키 목록은 [UI-KEYS.md](UI-KEYS.md)를 참고하세요.

## 사이트 패치에 대응하기

UI 선택 규칙을 바꿀 때는 `ui.configure(key, definition)`으로 해당 인스턴스의 정의를 교체합니다. API 변경은 새 배포 파일과 변경 문서를 확인해 반영하세요.

2.1.0에서 JavaScript 변경 파일은 `index.js`입니다. 기존 UI 및 기능별 번들은 그대로 사용할 수 있습니다. [메모리 패치 명세](MEMORY-PATCH.md)에는 실제 호출 경로와 제한, 기존 함수와의 차이가 있습니다.

## 확인 범위

공식 SDK가 아니며 크랙의 페이지 코드와 관찰된 요청을 바탕으로 작성했습니다. 사이트 변경에 따라 요청 경로·응답·UI 구조가 달라질 수 있습니다.

- `observed-http-status`: 해당 정규화 경로의 HTTP 응답 상태를 관찰했습니다. SDK 호출과 응답의 모든 필드를 실서버에서 검증했다는 뜻은 아닙니다.
- `loaded-source-only`: 로드된 페이지 소스에서 호출을 확인했습니다. 실제 실행 성공은 미확인입니다.
- 모듈 분리 후 단독 번들 로드·export 일치·의존 관계를 검사했습니다. UI 어댑터의 로컬 브라우저 회귀 테스트 19개가 통과했습니다.
- 결제·유료 생성·글 작성·설정 저장을 포함한 모든 변경 API의 실서버 실행 검증은 수행하지 않았습니다.

필요한 기능부터 조회로 확인하고, 서버를 변경하는 호출은 명시적인 사용자 동작에 연결하세요.
