# Crack SDK 1.3.0 — 전체 호출 방식·기능 명세

작성 기준: 2026-09-10, 이 폴더의 실제 `src/index.js` 및 모듈 코드. 런타임 의존성은 표준 브라우저 API와 필요한 로컬 파일뿐입니다. 이 문서는 현재 구현을 설명하며 사이트 전체 API의 공식 명세는 아닙니다.

## 목차

- [시작과 공통 규약](#시작과-공통-규약)
- [신규 HTTP 모듈 54개](#신규-http-모듈-54개)
- [기존 채팅·작품 API](#기존-채팅작품-api)
- [소켓과 채팅 세션](#소켓과-채팅-세션)
- [전체 최상위 함수](#전체-최상위-함수)
- [UI 어댑터](#ui-어댑터)
- [UI 키 전체 목록](#ui-키-전체-목록)
- [저장소·노트 객체](#저장소노트-객체)
- [상수와 오류](#상수와-오류)
- [미확인 소스 경로 후보](#미확인-소스-경로-후보)

## 시작과 공통 규약

```js
import * as SDK from './src/index.js';
const api = SDK.createCrackAPI();
const discovery = SDK.createDiscoveryAPI();
const profiles = SDK.createProfilesAPI();
const community = SDK.createCommunityAPI();
const library = SDK.createLibraryAPI();
const ui = SDK.createPageUI();
```

브라우저 전체 번들은 `dist/crack.js` → 전역 `Crack`. 기능별 번들은 `crack-discovery.js` → `CrackDiscovery`, `crack-profiles.js` → `CrackProfiles`, `crack-community.js` → `CrackCommunity`, `crack-library.js` → `CrackLibrary`, `crack-ui.js` → `CrackUI`입니다. 개별 번들은 필요한 공통 코드를 포함합니다. 로드/팩토리 생성만으로 서버 요청·채팅 전송을 하지 않습니다. 감시/설치 함수는 호출 시 관찰/조회가 시작될 수 있습니다.

### HTTP options

| 옵션 | 의미 |
|---|---|
| request | 선택: async (path,{method,query,body,signal}) 요청기. 제공하면 기본 인증/HTTP 처리를 대체 |
| baseURL | 기본 https://crack-api.wrtn.ai. 다른 origin 요청은 기본 전송기에서 거부 |
| fetch | 기본 globalThis.fetch |
| token | 기본 access_token 쿠키를 요청 시 읽는 함수. 로그인 세션이 없는 컨텍스트에서는 직접 제공 |
| timeout | 기본 30000ms, 0이면 HTTP 타임아웃 없음 |

기본 전송기는 credentials: include, platform: web, wrtn-locale: ko-KR와 토큰이 있을 때 Authorization을 사용합니다. query의 null/undefined는 제외, 배열은 동일 키 반복, body 객체는 JSON 직렬화합니다. API wrapper는 응답에 data가 있으면 그 값을 반환합니다. 성공 응답의 필드 스키마는 강제로 잘라내지 않습니다.

### 인수 형태 차이

```js
// 신규 모듈: 경로 변수 + query/body를 하나의 객체에
profiles.describe('followers', {profileId: 'PROFILE_ID', query: {limit: 20}}); // 요청 없음
// await profiles.followers({profileId: 'PROFILE_ID', query: {limit: 20}}, {signal});
// 기존 모듈: 위치 인수
// await api.chat.get('CHAT_ID', {signal});
```

신규 함수의 경로 변수는 비어 있지 않은 문자열이고 URL 인코딩합니다. query/body 외 알 수 없는 최상위 키는 거부합니다. 신규 함수는 한 번 호출당 한 번 요청하며 자동 재시도/전체 수집을 하지 않습니다. body의 상세 필드는 서버 변경 가능성이 있어 소스와 응답을 확인해서 전달해야 합니다.

### 근거와 부작용

`observed-http-status`는 같은 정규화 경로에서 HTTP 상태를 관찰했다는 뜻이며 SDK 데이터 구조의 실서버 검증을 의미하지 않습니다. `loaded-source-only`는 페이지가 로드한 코드에서만 확인한 함수입니다. 기존 함수는 이전 분석 및 로컬 테스트 유지 상태입니다. 이번 수집/모듈화에서 유료 생성·결제·피드 작성·설정 저장은 실행하지 않았습니다. HTTP 변경 함수는 호출하면 실제 변경될 수 있으며 별도의 UI allowEffects 제한을 적용받지 않습니다.

## 신규 HTTP 모듈 54개

### discovery

팩토리: `createDiscoveryAPI(options)`. 아래 모든 함수는 `Promise<data 또는 원본 응답>`를 반환합니다.

| 호출 | 기능 | 방식·경로 | 효과/근거 |
|---|---|---|---|
| `discovery.search({query?}, {signal}?)` | 통합 검색 | `GET /crack-page/search` | read / observed-http-status |
| `discovery.sortFilters({query?}, {signal}?)` | 검색 정렬 선택지 | `GET /crack-page/search/sort-filters` | read / observed-http-status |
| `discovery.contents({query?}, {signal}?)` | 스토리/캐릭터 검색 | `GET /crack-api/content/search` | read / observed-http-status |
| `discovery.tags({query?}, {signal}?)` | 해시태그 검색 | `GET /crack-api/content/search/tag` | read / observed-http-status |
| `discovery.series({query?}, {signal}?)` | 시리즈 검색 | `GET /crack-api/story-series/search` | read / observed-http-status |
| `discovery.profiles({query?}, {signal}?)` | 계정 검색 | `GET /crack-api/profiles/search` | read / loaded-source-only |
| `discovery.keywordRanking({query?}, {signal}?)` | 인기 검색어 | `GET /crack-api/keyword/ranking` | read / observed-http-status |
| `discovery.recentKeywords({query?}, {signal}?)` | 최근 검색어 | `GET /crack-api/keyword/recent` | read / observed-http-status |
| `discovery.genreNavigations({query?}, {signal}?)` | 홈 장르 메뉴 | `GET /crack-page/genre-navigations/web` | read / observed-http-status |
| `discovery.page({pageId, query?}, {signal}?)` | 홈 페이지 구성 | `GET /crack-page/pages/:pageId/web` | read / observed-http-status |

### profiles

팩토리: `createProfilesAPI(options)`. 아래 모든 함수는 `Promise<data 또는 원본 응답>`를 반환합니다.

| 호출 | 기능 | 방식·경로 | 효과/근거 |
|---|---|---|---|
| `profiles.me({query?}, {signal}?)` | 내 프로필 | `GET /crack-api/profiles` | read / observed-http-status |
| `profiles.get({userId, query?}, {signal}?)` | 사용자 프로필 | `GET /crack-api/profiles/:userId` | read / observed-http-status |
| `profiles.defaultImage({query?}, {signal}?)` | 기본 프로필 이미지 | `GET /crack-api/profiles/profile-image` | read / loaded-source-only |
| `profiles.onboardingStatus({query?}, {signal}?)` | 온보딩 상태 | `GET /crack-api/profiles/onboarding/check` | read / loaded-source-only |
| `profiles.shareURL({profileId, query?}, {signal}?)` | 공유 URL | `GET /crack-api/profiles/:profileId/share-url` | read / loaded-source-only |
| `profiles.agreements({profileId, query?}, {signal}?)` | 동의 상태 조회 | `GET /crack-api/profiles/:profileId/agreements` | read / loaded-source-only |
| `profiles.followers({profileId, query?}, {signal}?)` | 팔로워 목록 | `GET /crack-api/profiles/:profileId/followers` | read / observed-http-status |
| `profiles.followings({profileId, query?}, {signal}?)` | 팔로잉 목록 | `GET /crack-api/profiles/:profileId/followings` | read / loaded-source-only |
| `profiles.followingStatus({profileId, query?}, {signal}?)` | 팔로우 상태 | `GET /crack-api/profiles/:profileId/following-status` | read / loaded-source-only |
| `profiles.chatProfiles({profileId, query?}, {signal}?)` | 대화 프로필 목록 | `GET /crack-api/profiles/:profileId/chat-profiles` | read / loaded-source-only |
| `profiles.update({userId, query?, body?}, {signal}?)` | 프로필 수정 | `PATCH /crack-api/profiles/:userId` | write / loaded-source-only |
| `profiles.updateUISettings({query?, body?}, {signal}?)` | UI 설정 수정 | `PATCH /crack-api/profiles/ui-setting` | write / loaded-source-only |
| `profiles.validate({query?, body?}, {signal}?)` | 프로필 입력 검증 요청 | `POST /crack-api/profiles/validate-inputs` | write / loaded-source-only |
| `profiles.follow({profileId, query?, body?}, {signal}?)` | 팔로우 추가 | `POST /crack-api/profiles/:profileId/follow` | write / loaded-source-only |
| `profiles.unfollow({profileId, query?, body?}, {signal}?)` | 팔로우 해제 | `DELETE /crack-api/profiles/:profileId/follow` | write / loaded-source-only |
| `profiles.updateFollowNotifications({profileId, query?, body?}, {signal}?)` | 팔로우 알림 설정 수정 | `PATCH /crack-api/profiles/:profileId/follow` | write / loaded-source-only |
| `profiles.createChatProfile({profileId, query?, body?}, {signal}?)` | 대화 프로필 생성 | `POST /crack-api/profiles/:profileId/chat-profiles` | write / loaded-source-only |
| `profiles.updateChatProfile({profileId, chatProfileId, query?, body?}, {signal}?)` | 대화 프로필 수정 | `PATCH /crack-api/profiles/:profileId/chat-profiles/:chatProfileId` | write / loaded-source-only |
| `profiles.deleteChatProfile({profileId, chatProfileId, query?, body?}, {signal}?)` | 대화 프로필 삭제 | `DELETE /crack-api/profiles/:profileId/chat-profiles/:chatProfileId` | write / loaded-source-only |
| `profiles.personalizedPages({query?}, {signal}?)` | 개인 맞춤 페이지 조회 | `GET /crack-api/pages/me` | read / observed-http-status |
| `profiles.updatePersonalizedPages({query?, body?}, {signal}?)` | 개인 맞춤 페이지 저장 | `PUT /crack-api/pages` | write / loaded-source-only |
| `profiles.badges({query?}, {signal}?)` | 활동 배지 목록 | `GET /crack-api/assignments` | read / observed-http-status |
| `profiles.badge({assignmentId, query?}, {signal}?)` | 활동 배지 상세 | `GET /crack-api/assignments/:assignmentId` | read / loaded-source-only |
| `profiles.blocks({query?}, {signal}?)` | 차단 목록 | `GET /crack-api/block` | read / observed-http-status |

### community

팩토리: `createCommunityAPI(options)`. 아래 모든 함수는 `Promise<data 또는 원본 응답>`를 반환합니다.

| 호출 | 기능 | 방식·경로 | 효과/근거 |
|---|---|---|---|
| `community.announcements({query?}, {signal}?)` | 공지 목록 | `GET /crack-api/announcements` | read / observed-http-status |
| `community.announcementIndicator({query?}, {signal}?)` | 공지 표시 상태 | `GET /crack-api/announcements/noti` | read / observed-http-status |
| `community.notifications({query?}, {signal}?)` | 알림 목록 | `GET /crack-api/alarm` | read / observed-http-status |
| `community.notificationIndicator({query?}, {signal}?)` | 새 알림 상태 | `GET /crack-api/alarm/check` | read / observed-http-status |
| `community.feeds({query?}, {signal}?)` | 피드 목록 | `GET /crack-api/feeds` | read / observed-http-status |
| `community.feed({feedId, query?}, {signal}?)` | 피드 상세 | `GET /crack-api/feeds/:feedId` | read / loaded-source-only |
| `community.comments({feedId, query?}, {signal}?)` | 피드 댓글 목록 | `GET /crack-api/feeds/:feedId/comments` | read / loaded-source-only |
| `community.pinnedComments({feedId, query?}, {signal}?)` | 고정 댓글 | `GET /crack-api/feeds/:feedId/comments/pinned` | read / loaded-source-only |

### library

팩토리: `createLibraryAPI(options)`. 아래 모든 함수는 `Promise<data 또는 원본 응답>`를 반환합니다.

| 호출 | 기능 | 방식·경로 | 효과/근거 |
|---|---|---|---|
| `library.subscribedSeries({query?}, {signal}?)` | 구독 시리즈 | `GET /crack-api/story-series/me/subscribed` | read / loaded-source-only |
| `library.selectableStories({query?}, {signal}?)` | 시리즈에 선택 가능한 내 작품 | `GET /crack-api/story-series/me/selectable-stories` | read / loaded-source-only |
| `library.ownContent({query?}, {signal}?)` | 내 작품 목록 | `GET /crack-api/content/me` | read / observed-http-status |
| `library.likedStories({query?}, {signal}?)` | 좋아요 작품 | `GET /crack-api/stories/me/liked` | read / observed-http-status |
| `library.collections({query?}, {signal}?)` | 콘텐츠 컬렉션 | `GET /crack-api/content-collections` | read / observed-http-status |
| `library.stories({query?}, {signal}?)` | 스토리 목록 | `GET /crack-api/stories` | read / observed-http-status |
| `library.characters({query?}, {signal}?)` | 캐릭터 목록 | `GET /crack-api/characters` | read / observed-http-status |
| `library.storyRanking({query?}, {signal}?)` | 스토리 랭킹 | `GET /crack-api/stories/ranking` | read / observed-http-status |
| `library.temporaryStories({query?}, {signal}?)` | 미등록 스토리 | `GET /crack-api/temp-stories` | read / observed-http-status |
| `library.chatFolders({query?}, {signal}?)` | 채팅 보관함 | `GET /crack-gen/chat-folders` | read / observed-http-status |
| `library.storyChats({query?}, {signal}?)` | 스토리 채팅 목록 | `GET /crack-gen/v3/chats` | read / observed-http-status |
| `library.characterChats({query?}, {signal}?)` | 캐릭터 채팅 목록 | `GET /crack-gen/character-chats` | read / observed-http-status |

공통 API 객체: `metadata`(함수별 정의), `describe(name, params={})`(요청 없이 경로·메서드·query·body·효과·근거 반환). describe는 body 원본을 포함할 수 있으므로 개인 데이터를 넣은 결과를 그대로 공유하지 마세요.

### 자주 쓰는 query/body 키

| 함수군 | 소스에서 확인한 입력 |
|---|---|
| discovery.search | query: {keyword, skipCorrection?} |
| discovery.contents | query: {query, type, limit, cursor?, sort?, skipCorrection?} |
| discovery.series | query: {keyword, limit, cursor?, sort?, skipCorrection?}; UI의 정렬 변환은 SDK에서 자동 수행하지 않음 |
| discovery.tags / profiles | query: {query, limit, cursor?, skipCorrection?} |
| profiles.followers / followings | query: {limit, cursor?} |
| profiles.updateFollowNotifications | body: {notificationSetting} |
| community.announcements | query: {page, limit} |
| community.notifications | query: {page, limit, type?}; 전체는 type 생략, UI의 all 문자열을 자동 제거하지 않음 |
| community.feeds | query: {limit, cursor?, sort?, userId?} |
| community.comments | query: {limit, cursor?, ...필터} |
| profiles.badges | query: {page, limit, status?}; 서버 page는 UI의 0기반 인덱스+1 |
| profiles.blocks | query: {type, page, limit} |
| library.subscribedSeries | query: {sort, limit, cursor?} |

## 기존 채팅·작품 API

`api = createCrackAPI(options)`의 반환 객체입니다. `options`에는 일반 HTTP 호출의 signal/query 등을 전달합니다. 변경 함수의 body 필드는 호출자가 명시합니다. 표의 반환 구분은 아래 공통 설명을 따릅니다.

### api.chat

| 호출 | 기능 |
|---|---|
| `api.chat.get(id, options)` | 채팅 상세 |
| `api.chat.getMessage(id, messageId, options)` | 메시지 상세 |
| `api.chat.messages(id, options = {})` | 메시지 순회 |
| `api.chat.export(id, options = {})` | 전체 메시지 배열 |
| `api.chat.last(id, role, options = {})` | 역할 조건에 맞는 최근 메시지 |
| `api.chat.update(id, body, options = {})` | 채팅 설정 수정 |
| `api.chat.editMessage(id, messageId, body, options = {})` | 메시지 수정 |
| `api.chat.deleteMessage(id, messageId, options = {})` | 메시지 삭제 |
| `api.chat.create(body, options = {})` | 채팅 생성 |
| `api.chat.branch(id, body, options = {})` | 채팅 분기 |
| `api.chat.getDefaultSettings(options)` | 기본 설정 조회 |
| `api.chat.setDefaultSettings(body, options = {})` | 기본 설정 저장 |

### api.memory

| 호출 | 기능 |
|---|---|
| `api.memory.iterate(id, options = {})` | 요약 메모리 순회 |
| `api.memory.export(id, options = {})` | 메모리 배열 수집 |
| `api.memory.create(id, body, options = {})` | 장기 메모리 생성 |
| `api.memory.update(id, summaryId, body, options = {})` | 개별 메모리 수정 |
| `api.memory.delete(id, summaryId, options = {})` | 개별 메모리 삭제 |
| `api.memory.version(id, options)` | 버전 조회 |
| `api.memory.setShortTerm(id, summary, options = {})` | 단기 요약 변경 |
| `api.memory.deleteMany(id, summaryIds, options = {})` | 여러 메모리 삭제 |
| `api.memory.markRead(id, options = {})` | 읽음 표시 |

### api.story

| 호출 | 기능 |
|---|---|
| `api.story.get(id, options)` | 내 스토리 상세 |
| `api.story.getPublic(id, options)` | 공개 스토리 상세 |
| `api.story.reserve(options = {})` | 미등록 스토리 예약 |
| `api.story.create(body, options = {})` | 스토리 생성 |
| `api.story.update(id, body, options = {})` | 스토리 수정 |

### api.character

| 호출 | 기능 |
|---|---|
| `api.character.get(id, options)` | 내 캐릭터 상세 |
| `api.character.getPublic(id, options)` | 공개 캐릭터 상세 |
| `api.character.reserve(options = {})` | 캐릭터 ID 예약 |
| `api.character.create(id, body, options = {})` | 캐릭터 생성 |
| `api.character.update(id, body, options = {})` | 캐릭터 수정 |

### api.drafts

| 호출 | 기능 |
|---|---|
| `api.drafts.iterate(storyId, options = {})` | 스토리 초안 순회 |
| `api.drafts.get(id, options)` | 초안 상세 |
| `api.drafts.save(storyId, body, options = {})` | 초안 저장 |
| `api.drafts.deleteMany(storyDraftIds, options = {})` | 초안 일괄 삭제 |

### api.userNote

| 호출 | 기능 |
|---|---|
| `api.userNote.get(chatId, options)` | 채팅 유저노트 조회 |
| `api.userNote.set(chatId, content, { isExtend = false, ...options } = {})` | 유저노트 수정 |

### api.account

| 호출 | 기능 |
|---|---|
| `api.account.attendance(options)` | 출석 상태 |
| `api.account.isAttendable(options)` | 미출석 여부 boolean |
| `api.account.attend(options = {})` | 실제 출석 처리 |
| `api.account.isAttendanceTime(now = new Date())` | 한국 시각 06시 이후 여부 |
| `api.account.crackers(options)` | 크래커 잔량 조회 |
| `api.account.models({ serviceType, storyId, signal } = {})` | 모델 배열 조회 |

### api.notifications

| 호출 | 기능 |
|---|---|
| `api.notifications.iterate(options = {})` | 알림 페이지 순회 |
| `api.notifications.list(options = {})` | 알림 배열 수집 |

### api.images

| 호출 | 기능 |
|---|---|
| `api.images.prepareStartingSet(options = {})` | 시작 세트 예약 |
| `api.images.renameCategory(body, options = {})` | 카테고리명 변경 |
| `api.images.renameSituation(body, options = {})` | 상황명 변경 |
| `api.images.delete(id, options = {})` | 상황 이미지 삭제 |
| `api.images.prepareBulk(body, options = {})` | 일괄 업로드 서명 요청 |
| `api.images.status(storyId, { baseSetIds, ...query }, options = {})` | 업로드/처리 진행 상태 |
| `api.images.upload(url, blob, { signal, fetch: uploadFetch = globalThis.fetch } = {})` | 서명 URL에 바이너리 PUT |

추가로 `api.request(path, options)`는 주입/기본 요청기 원본입니다. unwrapData를 자동 적용하지 않습니다.

- `chat.messages`, `memory.iterate`, `drafts.iterate`, `notifications.iterate`: AsyncGenerator. `for await`로 소비합니다.
- `chat.export`, `memory.export`, `notifications.list`: `Promise<Array>`. `chat.last`: `Promise<항목 또는 null>`.
- `userNote.get`: `Promise<노트 또는 null>`, `account.isAttendable`: `Promise<boolean>`, `account.models`: `Promise<Array>`.
- 일반 HTTP 함수: `Promise<data 또는 원본>`. `images.upload`: `Promise<void>`.
- 메시지 조회 기본 sortOrder=desc. chat.export/memory.export는 기본 역순 배열, notifications.list는 naturalOrder=true일 때 역순.
- 메모리 기본 조회 type=longTerm, orderBy=newest, filter=all. 생성 시 type=longTerm을 강제.
- 일반 유저노트는 500자 제한. 확장 사용은 isExtend=true를 명시.
- 이미지 status의 baseSetIds는 실제 query 키 baseSetIds[]로 전송. upload는 서명 HTTPS URL에 인증 헤더/쿠키 없이 PUT.

### 기존 API 경로 규칙

| 대상 | 기준 경로/규칙 |
|---|---|
| chat | /crack-gen/v3/chats, /:id/messages, /:id/messages/:messageId, /:id/branch, /default-chat-setting |
| memory | /crack-gen/v3/chats/:id/summaries, /:summaryId, /version, /read; 단기 요약 PUT, 개별 수정 PATCH |
| story | /crack-api/stories/me/:id (내 작품), /stories/:id (공개); 생성 POST /stories/v2, 수정 PATCH /stories/:id/v2; 예약 POST /temp-stories |
| character | /crack-api/characters/me/:id (내 작품), /characters/:id (공개/POST 생성/PUT 수정), /characters/new 예약 |
| drafts | /crack-api/story-drafts; 저장 POST /v2, 일괄 삭제 POST /delete-many |
| account | /crack-cash/attendance(GET/POST), /crack-cash/crackers(GET), /crack-gen/v3/chat-models(GET) |
| notifications | /crack-api/alarm, page 기반 |
| images | /crack-api/story-starting-sets/prepare; /crack-api/situation-images의 categories/situations PATCH, /:id DELETE, /presigned-urls/bulk POST, /stories/:id/starting-sets GET |

### 페이지 순회 옵션

`{max=-1, limit=20, delay=100, signal, query={}, mode="cursor"}`. max=-1은 제한 없음, max=0은 요청 없음, limit은 1~100. 잘못된 응답·반복 커서·반복 페이지는 예외입니다. 신규 모듈에는 이 자동 순회를 자동 적용하지 않습니다.

## 소켓과 채팅 세션

`createSocketTransport({baseURL, path="/character-chat/socket.io/", namespace="/v3/chats", auth, WebSocket, timeout=20000, onError})`. 기본 HTTPS origin을 WSS로 변환하고 EIO=4, transport=websocket을 사용합니다. 기본 auth는 access/refresh 쿠키를 읽는 함수이며 connect할 때 평가됩니다. Socket.IO 바이너리/폴링 fallback 전체 구현이 아니라 JSON over WebSocket 구현입니다.

| 호출 | 기능 |
|---|---|
| `socket.on(name, listener)` | 이벤트 구독 → 구독 해제 함수 |
| `socket.connect({ signal } = {})` | 연결/인증 → Promise; options의 signal로 취소 |
| `socket.emit(name, body)` | 이벤트 전송 → Promise<ACK>; 연결 전 호출은 실패 |
| `socket.close(reason = new Error("Socket closed"))` | 소켓 및 pending ACK 종료 → void |

`socket.connected`는 연결 상태 boolean입니다. 자동 재접속/명령 재전송은 하지 않습니다.

`session = createChatSession({chatId, kind="story", ...socketOptions})`. kind는 story/character. story namespace=/v3/chats, character namespace=/v1/character/chats.

| 호출 | 기능/효과 |
|---|---|
| `session.on(name, listener)` | 스트리밍/연결 이벤트 구독 → 해제 함수 |
| `session.connect(options)` | 소켓 연결 후 enter ACK까지 기다림 |
| `session.send(message, { prevMessageId } = {})` | send 이벤트: {chatId,message,prevMessageId?}; 생성 비용 발생 가능 |
| `session.stop()` | stop 이벤트: {chatId} |
| `session.reroll()` | reroll 이벤트: {chatId}; 생성 비용 발생 가능 |
| `session.continue(prevMessageId)` | continue 이벤트: {chatId,prevMessageId}; 생성 비용 발생 가능 |
| `session.autoPlay(prevMessageId)` | autoPlay 이벤트: {chatId,prevMessageId}; 생성 비용 발생 가능 |
| `session.generateEpilogue(prevMessageId)` | 스토리 전용 generateEpilogue 이벤트; 생성 비용 발생 가능 |
| `session.leave()` | exit를 보내고 소켓 종료 → Promise<void> |
| `session.close(reason = new Error("Socket closed"))` | exit ACK 대기 없이 즉시 연결 종료 |

`session.connected`: 연결 + enter 완료 상태. send 등은 connect 완료 후만 호출합니다. 반환된 ACK는 요청 수락이며 답변 생성 완료가 아닙니다. 생성 상태는 characterMessageLoading/Generating/Generated, userMessageCreated, generationError, imageCollected, parameterLoading 및 epilogue 관련 이벤트로 구분합니다.

## 전체 최상위 함수

이 표는 현재 index.js가 내보내는 모든 일반 함수의 실제 인수 목록입니다. 위 상세 섹션과 함께 사용하세요.

| 호출 | 기능/반환 |
|---|---|
| `backupChat(api, chatId, { signal, ...options } = {})` | 채팅과 메시지·메모리 조회 → 백업 객체. 서버 변경 없음. |
| `collect(iterator, { reverse = false } = {})` | 비동기 이터레이터 전체 수집 → Promise<Array>. |
| `createChatSession({ chatId, kind = "story", ...options })` | 스토리/캐릭터 채팅 세션 생성. 명령별 ACK와 스트리밍 이벤트 분리. |
| `createCommunityAPI(options = {})` | 공지/알림/피드 읽기 API 생성. |
| `createCrackAPI(options = {})` | 기존 채팅·작품·이미지 API 객체 생성. |
| `createDiscoveryAPI(options = {})` | 검색/탐색 API 생성. |
| `createEndpointModule(definitions, options = {})` | 정의에서 API 함수·metadata·describe 생성. 신규 기능 모듈의 공통 연결기. |
| `createLibraryAPI(options = {})` | 내 작품/시리즈/채팅 목록 API 생성. |
| `createLocalStore(namespace, storage = globalThis.localStorage)` | 이름공간이 있는 JSON 저장소 생성 → get/set/remove/keys 객체. |
| `createNotebook(store)` | 로컬 저장소 위에 작품별 노트 CRUD/apply 기능 생성. |
| `createPageUI({root=globalThis.document, map=UI_MAP, overrides={}, page, allowEffects=['navigate','local']}={})` | 패치 대응 UI 어댑터 생성 → resolve/click/health/watch 등. 네트워크 없음. |
| `createProfilesAPI(options = {})` | 프로필/설정 API 생성. |
| `createSocketTransport({ baseURL = "https://crack-api.wrtn.ai", path = "/character-chat/socket.io/", namespace = "/v3/chats", auth = () => { const token = readCookie("access_token"); return token ? { token: `Bearer ${token}`, refreshToken: readCookie("refresh_token") ?? "", platform: "web", wrtnLocale: "ko-KR" } : {}; }, WebSocket: Socket = globalThis.WebSocket, timeout = 20_000, onError = console.error, } = {})` | WebSocket 기반 Engine.IO/Socket.IO 연결기 생성 → 소켓 객체. connect 전에는 연결하지 않음. |
| `createTransport({ baseURL = "https://crack-api.wrtn.ai", fetch: fetchImpl = (...args) => globalThis.fetch(...args), token = () => readCookie("access_token"), timeout = 30_000, } = {})` | HTTP 요청기 생성 → request 함수. 생성만으로 요청하지 않음. |
| `decoratePrompt(key, create, root = document)` | 입력창 옆에 확프 장식 영역 삽입 → Element/null. key로 중복 방지. |
| `download(value, filename, { type = "application/json", doc = document } = {})` | 값/문자열/Blob을 로컬 파일로 다운로드 → void. |
| `embedImages(urls, { fetch: fetchImpl = globalThis.fetch, signal, maxBytes = 20 * 1024 * 1024 } = {})` | 이미지 URL들을 조회해 data URL로 내장 → URL 매핑. 외부 이미지 조회 발생, 인증 제외. |
| `escapeHTML(value)` | HTML 특수문자 이스케이프 → string. |
| `estimateRemainingMessages(quantity, cost)` | 잔량/단가로 가능한 횟수 계산 → number. |
| `exportHTML(messages, { title = "채팅 백업", markdown = false, media = {} } = {})` | 메시지 목록을 독립 HTML로 변환 → string. markdown/media 옵션 지원. |
| `exportJSON(value)` | 값을 들여쓰기 있는 JSON 문자열로 변환. |
| `exportText(messages)` | 메시지 목록을 평문으로 변환 → string. |
| `exportWork(kind, data)` | 스토리/캐릭터 원본을 작업 패키지 JSON으로 변환. |
| `getMessageId(element)` | 조상 메시지 그룹의 ID 읽기 → string/null. |
| `getPrompt(root = document)` | 레거시 메시지 입력 요소 찾기 → Element/null. |
| `getTheme(doc = document)` | DOM의 테마 읽기 → light/dark. |
| `identifyPage(url = globalThis.location?.href ?? 'https://crack.wrtn.ai/')` | 현재 경로를 UI 어댑터의 페이지 종류로 분류 → string. ID는 반환하지 않음. |
| `importJSON(text)` | JSON 문자열 해석 → 원본 값. 잘못된 JSON은 예외. |
| `importWork(text)` | 작업 패키지 형식 검사 후 반환. |
| `installBackupAction(api, { root = document, onError = console.error } = {})` | 백업 버튼 삽입 → 해제 함수. 버튼 실행 시 백업/다운로드. |
| `installCounter(api, { root = document, interval = 30_000, onError = console.error } = {})` | 메시지 수 표시 설치 → 해제 함수. 채팅 조회 발생. |
| `installFrozenThumbnails({ root = document, selector = 'img[alt="character_thumbnail"]' } = {})` | 썸네일 정지 프레임 표시 및 hover 복구 → 해제 함수. 이미지 생성 AI 사용 아님. |
| `installHiddenElements({ selector, root = document } = {})` | 호출자가 지정한 selector 요소 숨김 → 복구 함수. |
| `installLongPressCopy(api, { root = document, milliseconds = 650, onError = console.error } = {})` | 메시지 길게 누르기 복사 기능 설치 → 해제 함수. |
| `installPortraitLayout({ root = document, selector = '[data-testid="virtuoso-scroller"] img' } = {})` | 사이드바 썸네일 비율 변경 → 복구 함수. |
| `installResizableInputs({ root = document } = {})` | 빌더 textarea 크기 조절 스타일 → 복구/해제 함수. |
| `isAttendanceTime(now = new Date())` | 한국 시각 기준 06:00 이후인지 → boolean. 서버 출석 상태 확인은 아님. |
| `isChatRoute(route = parseRoute())` | 기존 route가 story/character이며 chatId가 있는지 → boolean. |
| `mountArticleAction(key, label, onClick, root = document)` | 작품 수정 메뉴에 버튼 삽입 → button/null. |
| `mountPanel({ title, render, doc = document })` | 모달 패널 생성 → 닫기 함수. |
| `mountSettingsButton(key, label, onClick, root = document)` | 기존 설정 링크 옆에 버튼 삽입 → button/null. |
| `mountSideAction(key, label, onClick, root = document)` | 채팅방 설정 주변에 버튼 삽입 → button/null. |
| `notifyDesktop(title, { body, tag, Notification: NotificationClass = globalThis.Notification } = {})` | 이미 허용된 브라우저 알림 표시 → Notification/null. |
| `openModelCosts({ quantity, models, costOf, doc = document })` | 모델 비용과 예상 횟수 패널 → 닫기 함수. |
| `openNotebook({ notebook, api, contentId, chatId, doc = document })` | 로컬 노트 패널 → 닫기 함수. 적용 버튼은 서버 유저노트 변경. |
| `paginate(request, path, field, { max = -1, limit = 20, delay = 100, signal, query = {}, mode = "cursor", } = {})` | cursor/page 방식 순회 → AsyncGenerator. 소비할 때 조회 요청 발생. |
| `parseRoute(pathname = globalThis.location?.pathname ?? "/")` | 기존 채팅/빌더 경로 분석 → kind와 해당 ID 필드. 식별 가능한 경로 범위는 identifyPage와 다름. |
| `poll(task, { interval = 30_000, maxInterval = Math.max(300_000, interval), onError = console.error } = {})` | 주기적 작업 실행 → 정지 함수. 오류 시 간격 증가; 작업 자체의 부작용은 task에 따름. |
| `prepareStoryCopy(source)` | 스토리 상세에서 별도 비공개 초안 본문 준비 → 객체. 서버 저장/게시 없음. |
| `readCookie(name, cookie = globalThis.document?.cookie ?? "")` | 쿠키 문자열에서 지정 이름 해석 → string/null. |
| `readPrompt(element = getPrompt())` | 입력 요소의 현재 문자열 읽기 → string. |
| `renderMarkdown(value, { media = {} } = {})` | Markdown을 제한된 안전한 HTML로 변환 → string. |
| `requestNotificationPermission(NotificationClass = globalThis.Notification)` | 브라우저 알림 권한 요청 → Promise<permission 또는 unsupported>. |
| `setPrompt(text, element = getPrompt())` | textarea/contenteditable 입력 수정 → void. 전송하지 않음. |
| `sleep(ms, signal)` | 취소 가능한 지연 → Promise<void>. |
| `toast(message, { duration = 3000, doc = document } = {})` | 화면 안내 표시 → 제거 함수. |
| `unwrapData(response)` | data 필드가 있으면 꺼내고 없으면 원본 반환. |
| `uploadSituationImages(api, { sourceId, files, startingSets }, { signal, concurrency = 4, timeout = 120_000, interval = 2_000, onProgress = () => {}, } = {})` | 이미지 서명 요청→업로드→진행 조회 → 완료/거부/실패 보고 객체. 파일 업로드 발생. |
| `verifyReadAccess(api, { chatId, storyId, characterId, signal, onResult = () => {} } = {})` | 선택한 읽기 API 및 응답 일부 구조 검사 → checks 보고서. 실서버 조회 발생. |
| `watchAttendance(api, { onAvailable = () => toast("크랙 출석을 할 수 있어요."), ...options } = {})` | 출석 가능 여부 조회 감시 → 정지 함수. 자동 출석하지 않음. |
| `watchDOM(callback, { root = document, delay = 60, onError = console.error } = {})` | DOM/주소 변경 감시 → 해제 함수. 레거시 감시기. |
| `watchMemory(api, { chatId = () => isChatRoute() ? parseRoute().chatId : null, onChange = () => toast("요약 메모리가 변경되었어요."), ...options } = {})` | 현재 채팅의 메모리 버전 조회 감시 → 정지 함수. |
| `watchNotifications(api, { onNotification = notification => toast(notification.title ?? notification.content ?? "새 알림"), ...options } = {})` | 알림 조회 감시 → 정지 함수. |

### 설치/관찰 함수 해제

poll/watch/install 계열 대부분은 해제 함수를 반환합니다. SPA를 떠나거나 확프를 종료할 때 호출해야 이벤트·타이머·스타일이 남지 않습니다. watchMemory/watchNotifications/watchAttendance/installCounter는 조회 통신을 할 수 있습니다. installHiddenElements는 검증된 selector를 요구합니다.

### 이미지 업로드 헬퍼

`uploadSituationImages(api, {sourceId, files:[{file,category,situation}], startingSets:[{baseSetId}]}, {signal,concurrency=4,timeout=120000,interval=2000,onProgress})`는 1~1000개 파일, concurrency 1~8을 받습니다. 반환 객체의 complete/rejected/failed/startingSets를 확인해야 합니다. 일부 실패를 성공으로 숨기지 않습니다.

### 읽기 검증 헬퍼

`verifyReadAccess`는 모델·출석·알림과 주어진 chatId/storyId/characterId의 읽기를 검사합니다. `checks`에는 이름·성공 여부·오류명/HTTP 상태 등만 담습니다. 채팅 전체 내보내기를 포함할 수 있으므로 대량 요청 가능성은 호출자가 고려해야 합니다.

## UI 어댑터

`createPageUI({root=document,map=UI_MAP,overrides={},page,allowEffects=["navigate","local"]})` → 아래 객체. page는 문자열 또는 현재 페이지 이름을 반환하는 함수입니다. 기본은 identifyPage(location.href).

| 호출 | 반환/동작 |
|---|---|
| ui.resolve(key) | {key,status,elements,page,kind,effect,tier,...}. 실제 DOM 참조 포함 |
| ui.inspect(key) | 본문·ID·입력값을 제외한 진단 객체 |
| ui.health(keys?) | 선택/전체 키의 진단 배열 |
| ui.element(key) | 유일한 요소. 없거나 모호하면 UIResolutionError |
| ui.elements(key) | collection 등의 요소 배열. 해석 실패 시 예외 |
| ui.click(key) | 매번 새 DOM에서 단일 control을 찾아 클릭 → {key,clicked:true,verified:false}. 화면 성공 확인은 별도 |
| ui.inventory() | {controls,inputs,containers}; 항목은 {element,tag,role,disabled} |
| ui.configure(key,definition) | 한 키의 정의 전체 교체 → void. 인스턴스별 복사본만 변경 |
| ui.definitions() | 현재 규칙 복사본 |
| ui.watch(callback,{delay=100}?) | 상태 변경 감시 → 해제 함수. DOM/resize/popstate 및 URL 300ms 검사 |

기본 클릭은 navigate/local 효과만 허용합니다. paid/write는 effect-blocked. scope가 없다고 body로 넓히지 않으며, 복수 후보에서 임의 첫 번째를 클릭하지 않습니다. 임의 순번·좌표·해시 클래스 대신 역할·이름·href·검증된 하위 구조를 우선합니다. 미래 패치를 자동으로 완전히 이해하는 시스템은 아닙니다.

상태: found, missing, ambiguous, wrong-page, scope-unavailable, disabled, invalid-config, unknown. 클릭 시 effect-blocked, overlay-blocked, stale, not-control도 사용합니다. UIResolutionError.report로 처리하세요. 콜백 해제·패치 대응 예시는 UI-ADAPTER.md 참조.

## UI 키 전체 목록

실제 사이트 전체에서 모두 일치함을 확인한 목록은 아닙니다. pages 조건과 scope를 적용하고 inspect로 확인하세요. tiers는 순서대로 평가하며, 한 단계에서 모호하면 중단합니다.

| 키 | 종류/효과 | scope / pages | 탐색 규칙 |
|---|---|---|---|
| `layout.main` | container / read | root / 제한 없음 | `[{"css":"main"},{"css":"[role=\"main\"]"}]` |
| `layout.navigation` | container / read | root / 제한 없음 | `[{"css":"nav[aria-label=\"주 메뉴\"]"},{"css":"header nav"},{"css":"[role=\"navigation\"]"}]` |
| `overlay.dialogs` | collection / read | root / 제한 없음 | `[{"css":"dialog[open],[role=\"dialog\"]"}]` |
| `overlay.menus` | collection / read | root / 제한 없음 | `[{"css":"[role=\"menu\"]"}]` |
| `profile.panel` | container / read | root / 제한 없음 | `[{"css":"[role=\"dialog\"],[role=\"menu\"]","contains":["개인 맞춤 설정","로그아웃"]}]` |
| `profile.trigger` | control / local | root / 제한 없음 | `[{"css":"button","names":["내 프로필","프로필 메뉴"]},{"css":"button[aria-haspopup=\"dialog\"]","has":"img"}]` |
| `search.input` | input / read | root / 제한 없음 | `[{"css":"input[role=\"combobox\"]","names":["검색어를 입력해 주세요"]},{"css":"input","placeholder":["검색어를 입력해 주세요"]}]` |
| `chat.editor` | input / read | layout.main / story-chat,character-chat | `[{"css":"textarea","placeholder":["메시지 보내기"]},{"css":"[contenteditable=\"true\"]","has":"[data-placeholder=\"메시지 보내기\"]"},{"css":".tiptap[contenteditable=\"true\"],.ProseMirror[contenteditable=\"true\"]","exclude":"[role=\"dialog\"]"}]` |
| `chat.messages` | collection / read | layout.main / story-chat,character-chat | `[{"css":"[data-message-group-id]"}]` |
| `chat.messageActions` | collection / read | layout.main / 제한 없음 | `[{"css":"button","names":["메시지 옵션"]}]` |
| `chat.settingsPanel` | container / read | layout.main / 제한 없음 | `[{"css":"[role=\"region\"]","names":["채팅방 설정"]},{"css":"section,aside","contains":["유저 노트","요약 메모리"]}]` |
| `works.rows` | collection / read | layout.main / works | `[{"css":"[data-content-id]"},{"css":"[role=\"listitem\"]"}]` |
| `profile.editForm` | container / read | root / 제한 없음 | `[{"css":"[role=\"dialog\"]","has":"input[type=\"file\"]","contains":["등록"]},{"css":"form","has":"textarea","contains":["등록"]}]` |
| `search.tabs` | container / read | layout.main / search | `[{"css":"[role=\"tablist\"]","contains":["계정","해시태그"]}]` |
| `profile.tabs` | container / read | layout.main / profile | `[{"css":"[role=\"tablist\"]","contains":["작품","피드"]}]` |
| `blocks.tabs` | container / read | layout.main / blocks | `[{"css":"[role=\"tablist\"]","contains":["제작자","해시태그"]}]` |
| `layout.forms` | collection / read | root / 제한 없음 | `[{"css":"form"}]` |
| `layout.tabPanels` | collection / read | root / 제한 없음 | `[{"css":"[role=\"tabpanel\"]"}]` |
| `layout.lists` | collection / read | layout.main / 제한 없음 | `[{"css":"[role=\"list\"],ul,ol"}]` |
| `notifications.panel` | container / read | root / 제한 없음 | `[{"css":"[role=\"dialog\"],section,aside","contains":["소식","팔로우","댓글"]}]` |
| `announcements.items` | collection / read | layout.main / announcements | `[{"css":"a[href^=\"/announcement/\"]"}]` |
| `profile.followers` | control / navigate | layout.main / profile | `[{"css":"a[href*=\"/follow?\"][href*=\"type=follower\"]"}]` |
| `profile.followings` | control / navigate | layout.main / profile | `[{"css":"a[href*=\"/follow?\"][href*=\"type=following\"]"}]` |
| `profile.badges` | control / navigate | layout.main / 제한 없음 | `[{"css":"a","path":"/profile/assignment"}]` |
| `overlay.close` | control / local | root / 제한 없음 | `[{"css":"[role=\"dialog\"] button,dialog[open] button","names":["닫기","Close"]}]` |
| `nav.home` | control / navigate | root / 제한 없음 | `[{"css":"a","path":"/","names":["스토리"]},{"css":"a","path":"/"}]` |
| `nav.characters` | control / navigate | root / 제한 없음 | `[{"css":"a","path":"/characters","names":["캐릭터"]},{"css":"a","path":"/characters"}]` |
| `nav.works` | control / navigate | root / 제한 없음 | `[{"css":"a","path":"/my","names":["내 작품"]},{"css":"a","path":"/my"}]` |
| `nav.images` | control / navigate | root / 제한 없음 | `[{"css":"a","path":"/image/generate","names":["이미지"]},{"css":"a","path":"/image/generate"}]` |
| `menu.announcements` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["공지"]}]` |
| `menu.subscriptions` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["구독함"]}]` |
| `menu.likes` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["좋아요 목록"]}]` |
| `menu.badges` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["활동 배지"]}]` |
| `menu.blocks` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["차단 관리"]}]` |
| `menu.settings` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["설정"]}]` |
| `menu.personalized` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["개인 맞춤 설정"]}]` |
| `menu.chatSettings` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["채팅방 설정"]}]` |
| `menu.invite` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["친구 초대"]}]` |
| `menu.coupon` | control / navigate | profile.panel / 제한 없음 | `[{"css":"a,button,[role=\"menuitem\"]","names":["쿠폰 등록"]}]` |
| `search.tab.전체` | control / navigate | layout.main / search | `[{"css":"[role=\"tab\"]","names":["전체"]}]` |
| `search.tab.스토리` | control / navigate | layout.main / search | `[{"css":"[role=\"tab\"]","names":["스토리"]}]` |
| `search.tab.시리즈` | control / navigate | layout.main / search | `[{"css":"[role=\"tab\"]","names":["시리즈"]}]` |
| `search.tab.캐릭터` | control / navigate | layout.main / search | `[{"css":"[role=\"tab\"]","names":["캐릭터"]}]` |
| `search.tab.계정` | control / navigate | layout.main / search | `[{"css":"[role=\"tab\"]","names":["계정"]}]` |
| `search.tab.해시태그` | control / navigate | layout.main / search | `[{"css":"[role=\"tab\"]","names":["해시태그"]}]` |
| `profile.tab.작품` | control / navigate | layout.main / profile | `[{"css":"[role=\"tab\"]","names":["작품"]}]` |
| `profile.tab.시리즈` | control / navigate | layout.main / profile | `[{"css":"[role=\"tab\"]","names":["시리즈"]}]` |
| `profile.tab.피드` | control / navigate | layout.main / profile | `[{"css":"[role=\"tab\"]","names":["피드"]}]` |
| `blocks.tab.스토리` | control / navigate | layout.main / blocks | `[{"css":"[role=\"tab\"]","names":["스토리"]}]` |
| `blocks.tab.캐릭터` | control / navigate | layout.main / blocks | `[{"css":"[role=\"tab\"]","names":["캐릭터"]}]` |
| `blocks.tab.제작자` | control / navigate | layout.main / blocks | `[{"css":"[role=\"tab\"]","names":["제작자"]}]` |
| `blocks.tab.해시태그` | control / navigate | layout.main / blocks | `[{"css":"[role=\"tab\"]","names":["해시태그"]}]` |
| `notifications.tab.전체` | control / navigate | notifications.panel / 제한 없음 | `[{"css":"[role=\"tab\"]","names":["전체"]}]` |
| `notifications.tab.소식` | control / navigate | notifications.panel / 제한 없음 | `[{"css":"[role=\"tab\"]","names":["소식"]}]` |
| `notifications.tab.좋아요` | control / navigate | notifications.panel / 제한 없음 | `[{"css":"[role=\"tab\"]","names":["좋아요"]}]` |
| `notifications.tab.댓글` | control / navigate | notifications.panel / 제한 없음 | `[{"css":"[role=\"tab\"]","names":["댓글"]}]` |
| `notifications.tab.팔로우` | control / navigate | notifications.panel / 제한 없음 | `[{"css":"[role=\"tab\"]","names":["팔로우"]}]` |
| `works.filter.전체` | control / navigate | layout.main / works | `[{"css":"button","names":["전체"]}]` |
| `works.filter.스토리` | control / navigate | layout.main / works | `[{"css":"button","names":["스토리"]}]` |
| `works.filter.캐릭터` | control / navigate | layout.main / works | `[{"css":"button","names":["캐릭터"]}]` |
| `works.filter.공개 여부` | control / navigate | layout.main / works | `[{"css":"button","names":["공개 여부"]}]` |
| `works.filter.미등록` | control / navigate | layout.main / works | `[{"css":"button","names":["미등록"]}]` |
| `works.filter.최신순` | control / navigate | layout.main / works | `[{"css":"button","names":["최신순"]}]` |
| `chat.settings.기본 설정` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["기본 설정"]}]` |
| `chat.settings.플레이 가이드` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["플레이 가이드"]}]` |
| `chat.settings.대화 프로필` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["대화 프로필"]}]` |
| `chat.settings.유저 노트` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["유저 노트"]}]` |
| `chat.settings.최대 출력량 조절` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["최대 출력량 조절"]}]` |
| `chat.settings.요약 메모리` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["요약 메모리"]}]` |
| `chat.settings.키보드 단축키` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["키보드 단축키"]}]` |
| `chat.settings.글꼴` | control / local | layout.main / story-chat,character-chat | `[{"css":"button","names":["글꼴"]}]` |
| `home.category.추천` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["추천"]}]` |
| `home.category.취향저격` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["취향저격"]}]` |
| `home.category.신규 랭킹` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["신규 랭킹"]}]` |
| `home.category.전체 랭킹` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["전체 랭킹"]}]` |
| `home.category.오늘 신작` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["오늘 신작"]}]` |
| `home.category.남성 인기` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["남성 인기"]}]` |
| `home.category.SF/판타지` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["SF/판타지"]}]` |
| `home.category.일상/현대` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["일상/현대"]}]` |
| `home.category.시뮬레이션` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["시뮬레이션"]}]` |
| `home.category.로맨스` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["로맨스"]}]` |
| `home.category.GL` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["GL"]}]` |
| `home.category.로판` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["로판"]}]` |
| `home.category.무협` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["무협"]}]` |
| `home.category.시대` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["시대"]}]` |
| `home.category.기타` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["기타"]}]` |
| `home.category.BL` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["BL"]}]` |
| `home.category.여성 인기` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["여성 인기"]}]` |
| `home.category.2차 창작` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["2차 창작"]}]` |
| `home.category.유틸리티` | control / navigate | layout.main / home,characters | `[{"css":"button","names":["유틸리티"]}]` |
| `chat.send` | control / paid | layout.main / story-chat,character-chat | `[{"css":"button","names":["전송","메시지 보내기"]}]` |
| `chat.reroll` | control / paid | layout.main / story-chat,character-chat | `[{"css":"button","names":["재생성","다시 생성"]}]` |
| `chat.continue` | control / paid | layout.main / story-chat,character-chat | `[{"css":"button","names":["이어쓰기","계속 생성"]}]` |
| `action.save` | control / write | root / 제한 없음 | `[{"css":"button","names":["저장","등록"]}]` |
| `action.delete` | control / write | root / 제한 없음 | `[{"css":"button","names":["삭제"]}]` |
| `action.post` | control / write | root / 제한 없음 | `[{"css":"button","names":["글쓰기"]}]` |
| `builder.tab.프로필` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["프로필","프로필 *"]}]` |
| `builder.tab.스토리설정` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["스토리설정","스토리설정 *"]}]` |
| `builder.tab.시작설정` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["시작설정","시작설정 *"]}]` |
| `builder.tab.스탯설정` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["스탯설정","스탯설정 *"]}]` |
| `builder.tab.미디어` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["미디어","미디어 *"]}]` |
| `builder.tab.키워드북` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["키워드북","키워드북 *"]}]` |
| `builder.tab.단축어` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["단축어","단축어 *"]}]` |
| `builder.tab.엔딩설정` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["엔딩설정","엔딩설정 *"]}]` |
| `builder.tab.등록` | control / local | layout.main / builder | `[{"css":"[role=\"tab\"],button","names":["등록","등록 *"]}]` |

## 저장소·노트 객체

`store = createLocalStore(namespace, storage=localStorage)`; `notebook = createNotebook(store)`. 로컬 CRUD는 서버에 저장하지 않습니다.

| 호출 | 동작 |
|---|---|
| `store.get(id, fallback = null)` | JSON 값 읽기 → 값/null (기본값 지원 여부는 실제 인수 참조) |
| `store.set(id, value)` | JSON 직렬화 저장 → 저장한 값 |
| `store.remove(id)` | 해당 키 삭제 → void |
| `store.keys()` | 이름공간 키 배열 |

| 호출 | 동작 |
|---|---|
| `notebook.save(contentId, name, content)` | 작품+이름별 노트 저장 → 노트 값 |
| `notebook.get(contentId, name)` | JSON 값 읽기 → 값/null (기본값 지원 여부는 실제 인수 참조) |
| `notebook.remove(contentId, name)` | 해당 키 삭제 → void |
| `notebook.list(contentId)` | 해당 작품 노트 배열 |
| `notebook.apply(api, chatId, contentId, name, options)` | 선택 노트를 서버 채팅 유저노트에 적용 → Promise. 서버 변경 발생 |

## 상수와 오류

| 이름 | 내용 |
|---|---|
| COMMUNITY_ENDPOINTS | COMMUNITY 신규 모듈 메서드/경로/효과/근거 정의 |
| DISCOVERY_ENDPOINTS | DISCOVERY 신규 모듈 메서드/경로/효과/근거 정의 |
| ENDPOINTS | 기존 HTTP 기준 경로 |
| LIBRARY_ENDPOINTS | LIBRARY 신규 모듈 메서드/경로/효과/근거 정의 |
| PROFILES_ENDPOINTS | PROFILES 신규 모듈 메서드/경로/효과/근거 정의 |
| SELECTORS | 레거시 입력창/메시지/메뉴 selector |
| UI_MAP | UI 키 정의 전체 (위 표) |

| 클래스 | 생성/필드 |
|---|---|
| HttpError | new HttpError(status,body,url); name/status/body/url. 서버 응답·URL이 포함될 수 있음 |
| ResponseError | new ResponseError(message); 예상 JSON/페이지 구조 오류 |
| UIResolutionError | new UIResolutionError(report); report는 UI 진단. 원문 HTML/입력값 없음 |

## 미확인 소스 경로 후보

아래는 수집한 페이지 소스 문자열 전체입니다. method가 미확정이면 실행 API로 간주하지 마세요. UI 라우트·동적 문자열·옛 코드가 섞일 수 있습니다. 이 표의 존재만으로 SDK 함수가 제공되거나 서버에서 성공한다는 뜻은 아닙니다. 정확한 파일/문자 위치와 전체 URL은 REFERENCE/endpoint-evidence.json에 있습니다.

| 경로 | 방법 | 분류 | 근거 파일 |
|---|---|---|---|
| `/alarm` | 미확정 | route-literal-candidate | 9821-ffceb9bdef2e1ed5.js |
| `/alarm/check` | 미확정 | route-literal-candidate | 9821-ffceb9bdef2e1ed5.js |
| `/alarm/check` | GET | http-call | 9821-ffceb9bdef2e1ed5.js |
| `/announcements` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/announcements/noti` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/assignments` | 미확정 | route-literal-candidate | assignment-34f5cf2d26a88b3f.js |
| `/assignments/:id` | 미확정 | route-literal-candidate | assignment-34f5cf2d26a88b3f.js |
| `/attendance` | 미확정 | route-literal-candidate | 561-06a49226ce4c9f9d.js |
| `/block` | 미확정 | route-literal-candidate | block-center-e705d642fe39a422.js |
| `/block/clear` | 미확정 | route-literal-candidate | block-center-e705d642fe39a422.js |
| `/block/tag` | 미확정 | route-literal-candidate | block-center-e705d642fe39a422.js |
| `/cash` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/balance` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/costs` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/history` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/payment-history` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/products` | 미확정 | route-literal-candidate | 1506-f746bc689ba18777.js |
| `/cash/promotion-session` | 미확정 | route-literal-candidate | 1506-f746bc689ba18777.js |
| `/cash/received-support` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/reward-cards` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/reward-cards/check-in` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/cash/reward/welcomeCracker` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/character-chats` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/:id` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/:id/messages` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/:id/messages/:id` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/:id/pin` | 미확정 | route-literal-candidate | 2642-ea062c2385b1f1a3.js |
| `/character-chats/:id/snapshot/apply` | 미확정 | route-literal-candidate | 2496-b7d055dcea239eb8.js |
| `/character-chats/:id/summaries` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/:id/summaries/read` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/:id/unpin` | 미확정 | route-literal-candidate | 2642-ea062c2385b1f1a3.js |
| `/character-chats/characters/:id` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/check-contact-message` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/contact-setting` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/character-chats/delete` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/characters` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/characters` | POST | http-call | 8233-d2c17a461039e3c0.js |
| `/characters/:id` | 미확정 | route-literal-candidate | 9178-16c0c3c32617fb7a.js |
| `/characters/:id/character-user-actions` | 미확정 | route-literal-candidate | 9178-16c0c3c32617fb7a.js |
| `/characters/:id/character-user-actions/:id` | 미확정 | route-literal-candidate | 9178-16c0c3c32617fb7a.js |
| `/characters/:id/chats` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/characters/:id/chats/:id` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/characters/:id/comment-block` | 미확정 | route-literal-candidate | 9178-16c0c3c32617fb7a.js |
| `/characters/:id/detail` | 미확정 | route-literal-candidate | 8233-d2c17a461039e3c0.js |
| `/characters/:id/drafts` | 미확정 | route-literal-candidate | my-6720aa0336936a74.js |
| `/characters/:id/moderation/abort` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/characters/:id/moderation/acknowledge` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/characters/:id/moderation/cancel-schedule` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/characters/:id/moderation/retry` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/characters/:id/share-url` | 미확정 | route-literal-candidate | 8702-d0e13b51c39015d1.js |
| `/characters/:id/visibility` | 미확정 | route-literal-candidate | my-6720aa0336936a74.js |
| `/characters/[characterId]/chats/[[...chatId]]` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/characters/[characterId]/detail` | 미확정 | route-literal-candidate | 9178-16c0c3c32617fb7a.js |
| `/characters/drafts` | 미확정 | route-literal-candidate | my-6720aa0336936a74.js |
| `/characters/following` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/characters/me/following` | 미확정 | route-literal-candidate | 9178-16c0c3c32617fb7a.js |
| `/characters/me/liked` | 미확정 | route-literal-candidate | 8702-d0e13b51c39015d1.js |
| `/characters/new` | 미확정 | route-literal-candidate | 9178-16c0c3c32617fb7a.js |
| `/characters/trending` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/chat-folders` | 미확정 | route-literal-candidate | 2642-ea062c2385b1f1a3.js |
| `/chat-folders` | DELETE | http-call | 2642-ea062c2385b1f1a3.js |
| `/chat-folders` | POST | http-call | 2642-ea062c2385b1f1a3.js |
| `/chat-folders/:id` | PATCH | http-call | 2642-ea062c2385b1f1a3.js |
| `/chat-folders/:id/pin` | PATCH | http-call | 2642-ea062c2385b1f1a3.js |
| `/chat-folders/:id/unpin` | PATCH | http-call | 2642-ea062c2385b1f1a3.js |
| `/chat-folders/auto-organize/apply` | POST | http-call | 2642-ea062c2385b1f1a3.js |
| `/chat-folders/auto-organize/preview` | 미확정 | route-literal-candidate | 2642-ea062c2385b1f1a3.js |
| `/chat-folders/auto-organize/preview` | POST | http-call | 2642-ea062c2385b1f1a3.js |
| `/chat-folders/chats/move` | PATCH | http-call | 2642-ea062c2385b1f1a3.js |
| `/comments` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/comments/` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/comments/pinned` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/content` | 미확정 | route-literal-candidate | 8702-d0e13b51c39015d1.js |
| `/content-collections` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/content/:id` | 미확정 | route-literal-candidate | %5BuserId%5D-2e8091a151ef85b7.js |
| `/content/me` | 미확정 | route-literal-candidate | %5BuserId%5D-2e8091a151ef85b7.js |
| `/content/search` | 미확정 | route-literal-candidate | search-a2fc9e827c797044.js |
| `/content/search/tag` | 미확정 | route-literal-candidate | search-a2fc9e827c797044.js |
| `/crack-api` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/crack-api/profiles/profile-image` | 미확정 | route-literal-candidate | 9852.f91abbd2a5d32daa.js |
| `/crack-api/stories/` | 미확정 | route-literal-candidate | 9852.f91abbd2a5d32daa.js |
| `/crack-cash` | 미확정 | route-literal-candidate | crack-cash-8cd0e3275f17fa96.js |
| `/crack-cash/settlement` | 미확정 | route-literal-candidate | crack-cash-8cd0e3275f17fa96.js |
| `/crack-cash/withdrawal` | 미확정 | route-literal-candidate | crack-cash-8cd0e3275f17fa96.js |
| `/crack-gen` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/crack-gen/chat-models-v2` | 미확정 | route-literal-candidate | 9852.f91abbd2a5d32daa.js |
| `/crack-gen/party-chats/` | 미확정 | route-literal-candidate | 9852.f91abbd2a5d32daa.js |
| `/crack-page` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/crack-page/genre-navigations/web` | 미확정 | route-literal-candidate | 3785.dbc13fc299622276.js |
| `/crack-page/pages/` | 미확정 | route-literal-candidate | 3785.dbc13fc299622276.js |
| `/creators` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/creators/activities` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/creators/me/revenue` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/creators/me/revenue/visibility` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/creators/missions/start` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/creators/missions/status` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/creators/pre-missions/status` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/creators/welcome-kit` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/feed/` | 미확정 | route-literal-candidate | %5BuserId%5D-2e8091a151ef85b7.js |
| `/feeds` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds` | POST | http-call | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id` | DELETE | http-call | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id` | PUT | http-call | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/comments` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/comments/:id` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/comments/:id/like` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/comments/:id/pin` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/comments/:id/report` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/comments/:id/unpin` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/comments/pinned` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/like` | DELETE | http-call | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/like` | POST | http-call | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/feeds/:id/report` | POST | http-call | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/follow` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/followers` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/following` | 미확정 | route-literal-candidate | 1549.208c4df5ed03cbfc.js |
| `/games` | 미확정 | route-literal-candidate | 6845.d2b19583b5c92c58.js |
| `/genre-navigations/web` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/image-generations` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/image-generations/:id` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/image-generations/:id/images/:id` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/image-generations/:id/images/:id/like` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/image-generations/:id/status` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/image-generations/images` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/image-generations/prompt/optimize` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/image-generations/styles` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/image/generate` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/images` | 미확정 | route-literal-candidate | 1322-0e290e0be98b63e8.js |
| `/images/` | 미확정 | route-literal-candidate | generate-14852b27be44d119.js |
| `/keyword/ranking` | GET | http-call | 9821-ffceb9bdef2e1ed5.js |
| `/keyword/recent` | DELETE | http-call | 9821-ffceb9bdef2e1ed5.js |
| `/keyword/recent` | GET | http-call | 9821-ffceb9bdef2e1ed5.js |
| `/keyword/recent/purge` | 미확정 | route-literal-candidate | 9821-ffceb9bdef2e1ed5.js |
| `/keyword/recent/purge` | DELETE | http-call | 9821-ffceb9bdef2e1ed5.js |
| `/modals` | 미확정 | route-literal-candidate | 145-d372b8ab0763a851.js |
| `/pages` | 미확정 | route-literal-candidate | 8702-d0e13b51c39015d1.js |
| `/pages/:id/web` | 미확정 | route-literal-candidate | 145-d372b8ab0763a851.js |
| `/pages/me` | 미확정 | route-literal-candidate | personalized-2aea1c47d5f5921e.js |
| `/party-chats` | 미확정 | route-literal-candidate | 480-319d66a7095e23ba.js |
| `/party-chats/` | 미확정 | route-literal-candidate | 3790-46ab0a2252e37a18.js |
| `/party-chats/:id` | 미확정 | route-literal-candidate | 480-319d66a7095e23ba.js |
| `/party-chats/:id/entered` | 미확정 | route-literal-candidate | 480-319d66a7095e23ba.js |
| `/party-chats/:id/snapshot/apply` | 미확정 | route-literal-candidate | 2496-b7d055dcea239eb8.js |
| `/profile/` | 미확정 | route-literal-candidate | 5203-3515f5f253e2ab96.js |
| `/profile/:id` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/profile/:id/feed/:id` | 미확정 | route-literal-candidate | %5BuserId%5D-2e8091a151ef85b7.js |
| `/profile/:id/follow` | 미확정 | route-literal-candidate | %5BuserId%5D-2e8091a151ef85b7.js |
| `/profile/[userId]` | 미확정 | route-literal-candidate | %5BuserId%5D-2e8091a151ef85b7.js |
| `/profile/[userId]/feed/[feedId]` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/profile/[userId]/follow` | 미확정 | route-literal-candidate | follow-5fa7d870b26c82a9.js |
| `/profile/assignment` | 미확정 | route-literal-candidate | %5BuserId%5D-2e8091a151ef85b7.js |
| `/profile/chat-profile` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/agreement` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/agreements` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/chat-profiles` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/chat-profiles/:id` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/follow` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/followers` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/following-status` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/followings` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/:id/share-url` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/block` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/cost-guide-dismissal` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/onboarding` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/onboarding/check` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/profile-image` | 미확정 | route-literal-candidate | 9852.f91abbd2a5d32daa.js |
| `/profiles/search` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/support` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/ui-setting` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/v2/random-nickname` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/profiles/validate-inputs` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/search` | 미확정 | route-literal-candidate | 3785.dbc13fc299622276.js |
| `/search/sort-filters` | 미확정 | route-literal-candidate | search-a2fc9e827c797044.js |
| `/setting` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/setting/chat` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |
| `/setting/personalized` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/setting/slash-command` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/situation-images/delete` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/situation-images/generate` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/situation-images/status` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id` | 미확정 | route-literal-candidate | 4154-4ef64714d8e585b1.js |
| `/stories/:id/associated-characters` | 미확정 | route-literal-candidate | 8233-d2c17a461039e3c0.js |
| `/stories/:id/comments` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/comments/:id` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/comments/:id/like` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/comments/:id/pin` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/comments/:id/report` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/comments/:id/unpin` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/comments/pinned` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/episodes` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/stories/:id/episodes/:id` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/:id/moderation/abort` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/stories/:id/moderation/acknowledge` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/stories/:id/moderation/cancel-schedule` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/stories/:id/moderation/retry` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/stories/:id/parties/:id` | 미확정 | route-literal-candidate | 2642-ea062c2385b1f1a3.js |
| `/stories/:id/parties/:id/enter` | 미확정 | route-literal-candidate | 6094-badaaa0e61af927f.js |
| `/stories/:id/parties/:id/host` | 미확정 | route-literal-candidate | 5444-ddd5cebb69425973.js |
| `/stories/:id/parties/:id/invitations` | 미확정 | route-literal-candidate | 3754-d8481485e10c9a85.js |
| `/stories/:id/parties/new` | 미확정 | route-literal-candidate | 3754-d8481485e10c9a85.js |
| `/stories/:id/report-image` | 미확정 | route-literal-candidate | 8233-d2c17a461039e3c0.js |
| `/stories/:id/sequel-audit-status` | 미확정 | route-literal-candidate | 4154-4ef64714d8e585b1.js |
| `/stories/:id/share-url` | 미확정 | route-literal-candidate | 8702-d0e13b51c39015d1.js |
| `/stories/:id/story-user-actions` | 미확정 | route-literal-candidate | 8233-d2c17a461039e3c0.js |
| `/stories/:id/story-user-actions/:id` | 미확정 | route-literal-candidate | 8233-d2c17a461039e3c0.js |
| `/stories/:id/v2` | 미확정 | route-literal-candidate | my-6720aa0336936a74.js |
| `/stories/[storyId]/detail` | 미확정 | route-literal-candidate | 8233-d2c17a461039e3c0.js |
| `/stories/[storyId]/episodes/[[...chatId]]` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/stories/[storyId]/parties/[partyChatId]` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/stories/[storyId]/parties/[partyChatId]/enter` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/stories/[storyId]/parties/[partyChatId]/host` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/stories/[storyId]/parties/[partyChatId]/invitations` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/stories/[storyId]/parties/new` | 미확정 | route-literal-candidate | _buildManifest.js |
| `/stories/me/:id` | 미확정 | route-literal-candidate | 4154-4ef64714d8e585b1.js |
| `/stories/me/following` | 미확정 | route-literal-candidate | 3785.dbc13fc299622276.js |
| `/stories/me/liked` | 미확정 | route-literal-candidate | 8702-d0e13b51c39015d1.js |
| `/stories/original/filter` | 미확정 | route-literal-candidate | 3785.dbc13fc299622276.js |
| `/stories/ranking` | 미확정 | route-literal-candidate | 1324-96111187d0a9f63a.js |
| `/stories/recommendations/attendance` | 미확정 | route-literal-candidate | 561-06a49226ce4c9f9d.js |
| `/story-series` | POST | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id` | DELETE | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id` | PATCH | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/addons/categories` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/addons/groups` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/addons/items` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/me/stories` | 미확정 | route-literal-candidate | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/meta-audits` | POST | http-call | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/meta-audits/latest` | 미확정 | route-literal-candidate | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/meta-audits/latest` | DELETE | http-call | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/publish` | POST | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/report` | POST | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/sequel-audits` | POST | http-call | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/sequel-audits/:id` | DELETE | http-call | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/sequel-audits/results` | 미확정 | route-literal-candidate | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/sequel-audits/results/ack` | POST | http-call | 4154-4ef64714d8e585b1.js |
| `/story-series/:id/share-url` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/stories` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/subscription` | DELETE | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/subscription` | POST | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/:id/unpublish` | POST | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/me/selectable-stories` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/me/subscribed` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/search` | 미확정 | route-literal-candidate | search-a2fc9e827c797044.js |
| `/story-series/stories/sort` | POST | http-call | %5BseriesId%5D-4f2703908d3344d0.js |
| `/story-series/user/:id` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/temp-stories` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/temp-stories/:id` | 미확정 | route-literal-candidate | %5BseriesId%5D-4f2703908d3344d0.js |
| `/user` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/user/extend` | 미확정 | route-literal-candidate | setting-59c9847d829f4be1.js |
| `/user/verify` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/user/verify` | GET | http-call | _app-995c29090acd8bf6.js |
| `/v1/payments/purchasable` | 미확정 | route-literal-candidate | 1506-f746bc689ba18777.js |
| `/v1/payments/register` | POST | http-call | 1506-f746bc689ba18777.js |
| `/v1/payments/web/one-time/toss-pay` | 미확정 | route-literal-candidate | 1506-f746bc689ba18777.js |
| `/v1/track` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/v2` | 미확정 | route-literal-candidate | my-6720aa0336936a74.js |
| `/v2/authorize` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/v2/chat-models` | 미확정 | route-literal-candidate | 4395-7f627cb0da58f320.js |
| `/v2/token/refresh` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/v2/user` | 미확정 | route-literal-candidate | _app-995c29090acd8bf6.js |
| `/v2/user` | GET | http-call | _app-995c29090acd8bf6.js |
| `/v2/user/extend` | GET | http-call | setting-59c9847d829f4be1.js |
| `/v3/chat-models` | 미확정 | route-literal-candidate | 4395-7f627cb0da58f320.js |
| `/v3/chat-models/errors` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/v3/chats` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/v3/chats/:id` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id` | PATCH | http-call | 2642-ea062c2385b1f1a3.js |
| `/v3/chats/:id/apply-replacement-model` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/branch` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/endings/hints/:id/check` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/v3/chats/:id/endings/hints/:id/dismiss` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/v3/chats/:id/endings/hints/latest` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/v3/chats/:id/messages` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/messages/:id` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/pin` | PATCH | http-call | 2642-ea062c2385b1f1a3.js |
| `/v3/chats/:id/snapshot/apply` | 미확정 | route-literal-candidate | 2496-b7d055dcea239eb8.js |
| `/v3/chats/:id/stats` | 미확정 | route-literal-candidate | %5B%5B...chatId%5D%5D-e5d95483c4bcdf68.js |
| `/v3/chats/:id/summaries` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/summaries/:id` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/summaries/read` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/summaries/version` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/:id/unpin` | PATCH | http-call | 2642-ea062c2385b1f1a3.js |
| `/v3/chats/default-chat-setting` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/delete` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/v3/chats/delete` | POST | http-call | 2642-ea062c2385b1f1a3.js |
| `/v3/chats/stories/:id` | 미확정 | route-literal-candidate | %5BfeedId%5D-40bbf943221c4a9b.js |
| `/withdrawals` | 미확정 | route-literal-candidate | crack-cash-8cd0e3275f17fa96.js |
| `/withdrawals/data` | 미확정 | route-literal-candidate | 1445-26b08898e57587cb.js |

## 검증과 한계

- Node 자동 테스트 51개, 로컬 브라우저 UI 테스트 19개 통과한 SDK 1.3.0을 기준으로 작성했습니다.
- 실측 HTTP 상태와 로컬 테스트를 실제 서버의 모든 변경 함수 검증으로 오해하지 마세요. UI 의미 키 일부는 추후 사이트에서 추가 검증이 필요합니다.
- 코드에 정의된 기능을 정리하는 문서 작업이며 채팅 전송·유료 생성·결제·피드 작성·프로필 저장을 실행하지 않았습니다.
- 전체 source 155개, 경로 후보 293개를 보관했습니다. 실측 정규화 시리즈 두 행의 과도한 ID 일반화 문제는 REFERENCE/ADDITIONAL-COLLECTION.md에 설명되어 있습니다.
- Tampermonkey Network Recorder는 SDK와 별도인 관찰 도구입니다. 기록기 설치/JSON·CSV 내보내기는 ../crack-api-recorder/README.md에 있으며 SDK API로 자동 호출되지 않습니다.

