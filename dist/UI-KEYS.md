# UI 의미 키 목록

`ui.js`를 로드한 뒤 `const ui = CrackUI.createPageUI()`로 사용합니다. `ui.inspect(key)`로 확인하고, `ui.configure(key, definition)`으로 탐색 규칙을 교체할 수 있습니다. 2.1.0의 요약메모리 변경은 API 업데이트이며 이 UI 키 목록은 변경하지 않았습니다.

[사용법](README.md#ui-사용하기) · [요약메모리 API](MEMORY-PATCH.md)

실제 사이트의 전체 DOM을 확정한 목록이 아니라 관찰한 기능과 대체 구조를 등록한 목록입니다. 사용 시 inspect/health로 일치 여부를 확인하세요.

| 키 | 종류 | 범위 | 효과 |
|---|---|---|---|
| `layout.main` | container | root | read |
| `layout.navigation` | container | root | read |
| `overlay.dialogs` | collection | root | read |
| `overlay.menus` | collection | root | read |
| `profile.panel` | container | root | read |
| `profile.trigger` | control | root | local |
| `search.input` | input | root | read |
| `chat.editor` | input | layout.main | read |
| `chat.messages` | collection | layout.main | read |
| `chat.messageActions` | collection | layout.main | read |
| `chat.settingsPanel` | container | layout.main | read |
| `works.rows` | collection | layout.main | read |
| `profile.editForm` | container | root | read |
| `search.tabs` | container | layout.main | read |
| `profile.tabs` | container | layout.main | read |
| `blocks.tabs` | container | layout.main | read |
| `layout.forms` | collection | root | read |
| `layout.tabPanels` | collection | root | read |
| `layout.lists` | collection | layout.main | read |
| `notifications.panel` | container | root | read |
| `announcements.items` | collection | layout.main | read |
| `profile.followers` | control | layout.main | navigate |
| `profile.followings` | control | layout.main | navigate |
| `profile.badges` | control | layout.main | navigate |
| `overlay.close` | control | root | local |
| `nav.home` | control | root | navigate |
| `nav.characters` | control | root | navigate |
| `nav.works` | control | root | navigate |
| `nav.images` | control | root | navigate |
| `menu.announcements` | control | profile.panel | navigate |
| `menu.subscriptions` | control | profile.panel | navigate |
| `menu.likes` | control | profile.panel | navigate |
| `menu.badges` | control | profile.panel | navigate |
| `menu.blocks` | control | profile.panel | navigate |
| `menu.settings` | control | profile.panel | navigate |
| `menu.personalized` | control | profile.panel | navigate |
| `menu.chatSettings` | control | profile.panel | navigate |
| `menu.invite` | control | profile.panel | navigate |
| `menu.coupon` | control | profile.panel | navigate |
| `search.tab.전체` | control | layout.main | navigate |
| `search.tab.스토리` | control | layout.main | navigate |
| `search.tab.시리즈` | control | layout.main | navigate |
| `search.tab.캐릭터` | control | layout.main | navigate |
| `search.tab.계정` | control | layout.main | navigate |
| `search.tab.해시태그` | control | layout.main | navigate |
| `profile.tab.작품` | control | layout.main | navigate |
| `profile.tab.시리즈` | control | layout.main | navigate |
| `profile.tab.피드` | control | layout.main | navigate |
| `blocks.tab.스토리` | control | layout.main | navigate |
| `blocks.tab.캐릭터` | control | layout.main | navigate |
| `blocks.tab.제작자` | control | layout.main | navigate |
| `blocks.tab.해시태그` | control | layout.main | navigate |
| `notifications.tab.전체` | control | notifications.panel | navigate |
| `notifications.tab.소식` | control | notifications.panel | navigate |
| `notifications.tab.좋아요` | control | notifications.panel | navigate |
| `notifications.tab.댓글` | control | notifications.panel | navigate |
| `notifications.tab.팔로우` | control | notifications.panel | navigate |
| `works.filter.전체` | control | layout.main | navigate |
| `works.filter.스토리` | control | layout.main | navigate |
| `works.filter.캐릭터` | control | layout.main | navigate |
| `works.filter.공개 여부` | control | layout.main | navigate |
| `works.filter.미등록` | control | layout.main | navigate |
| `works.filter.최신순` | control | layout.main | navigate |
| `chat.settings.기본 설정` | control | layout.main | local |
| `chat.settings.플레이 가이드` | control | layout.main | local |
| `chat.settings.대화 프로필` | control | layout.main | local |
| `chat.settings.유저 노트` | control | layout.main | local |
| `chat.settings.최대 출력량 조절` | control | layout.main | local |
| `chat.settings.요약 메모리` | control | layout.main | local |
| `chat.settings.키보드 단축키` | control | layout.main | local |
| `chat.settings.글꼴` | control | layout.main | local |
| `home.category.추천` | control | layout.main | navigate |
| `home.category.취향저격` | control | layout.main | navigate |
| `home.category.신규 랭킹` | control | layout.main | navigate |
| `home.category.전체 랭킹` | control | layout.main | navigate |
| `home.category.오늘 신작` | control | layout.main | navigate |
| `home.category.남성 인기` | control | layout.main | navigate |
| `home.category.SF/판타지` | control | layout.main | navigate |
| `home.category.일상/현대` | control | layout.main | navigate |
| `home.category.시뮬레이션` | control | layout.main | navigate |
| `home.category.로맨스` | control | layout.main | navigate |
| `home.category.GL` | control | layout.main | navigate |
| `home.category.로판` | control | layout.main | navigate |
| `home.category.무협` | control | layout.main | navigate |
| `home.category.시대` | control | layout.main | navigate |
| `home.category.기타` | control | layout.main | navigate |
| `home.category.BL` | control | layout.main | navigate |
| `home.category.여성 인기` | control | layout.main | navigate |
| `home.category.2차 창작` | control | layout.main | navigate |
| `home.category.유틸리티` | control | layout.main | navigate |
| `chat.send` | control | layout.main | paid |
| `chat.reroll` | control | layout.main | paid |
| `chat.continue` | control | layout.main | paid |
| `action.save` | control | root | write |
| `action.delete` | control | root | write |
| `action.post` | control | root | write |
| `builder.tab.프로필` | control | layout.main | local |
| `builder.tab.스토리설정` | control | layout.main | local |
| `builder.tab.시작설정` | control | layout.main | local |
| `builder.tab.스탯설정` | control | layout.main | local |
| `builder.tab.미디어` | control | layout.main | local |
| `builder.tab.키워드북` | control | layout.main | local |
| `builder.tab.단축어` | control | layout.main | local |
| `builder.tab.엔딩설정` | control | layout.main | local |
| `builder.tab.등록` | control | layout.main | local |
