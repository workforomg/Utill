/** Editable site knowledge. No network, class hashes, coordinates or React internals. */
export const UI_MAP = {
  'layout.main': {kind:'container', tiers:[{css:'main'}, {css:'[role="main"]'}]},
  'layout.navigation': {kind:'container', tiers:[{css:'nav[aria-label="주 메뉴"]'}, {css:'header nav'}, {css:'[role="navigation"]'}]},
  'overlay.dialogs': {kind:'collection', tiers:[{css:'dialog[open],[role="dialog"]'}]},
  'overlay.menus': {kind:'collection', tiers:[{css:'[role="menu"]'}]},
  'profile.panel': {kind:'container', tiers:[{css:'[role="dialog"],[role="menu"]',contains:['개인 맞춤 설정','로그아웃']}]},
  'profile.trigger': {kind:'control',effect:'local',tiers:[{css:'button',names:['내 프로필','프로필 메뉴']},{css:'button[aria-haspopup="dialog"]',has:'img'}]},
  'search.input': {kind:'input',tiers:[{css:'input[role="combobox"]',names:['검색어를 입력해 주세요']},{css:'input',placeholder:['검색어를 입력해 주세요']}]},
  'chat.editor': {kind:'input',scope:'layout.main',pages:['story-chat','character-chat'],tiers:[{css:'textarea',placeholder:['메시지 보내기']},{css:'[contenteditable="true"]',has:'[data-placeholder="메시지 보내기"]'},{css:'.tiptap[contenteditable="true"],.ProseMirror[contenteditable="true"]',exclude:'[role="dialog"]'}]},
  'chat.messages': {kind:'collection',scope:'layout.main',pages:['story-chat','character-chat'],tiers:[{css:'[data-message-group-id]'}]},
  'chat.messageActions': {kind:'collection',scope:'layout.main',tiers:[{css:'button',names:['메시지 옵션']}]},
  'chat.settingsPanel': {kind:'container',scope:'layout.main',tiers:[{css:'[role="region"]',names:['채팅방 설정']},{css:'section,aside',contains:['유저 노트','요약 메모리']}]},
  'works.rows': {kind:'collection',scope:'layout.main',pages:['works'],tiers:[{css:'[data-content-id]'}, {css:'[role="listitem"]'}]},
  'profile.editForm': {kind:'container',tiers:[{css:'[role="dialog"]',has:'input[type="file"]',contains:['등록']},{css:'form',has:'textarea',contains:['등록']}]},
  'search.tabs': {kind:'container',scope:'layout.main',pages:['search'],tiers:[{css:'[role="tablist"]',contains:['계정','해시태그']}]},
  'profile.tabs': {kind:'container',scope:'layout.main',pages:['profile'],tiers:[{css:'[role="tablist"]',contains:['작품','피드']}]},
  'blocks.tabs': {kind:'container',scope:'layout.main',pages:['blocks'],tiers:[{css:'[role="tablist"]',contains:['제작자','해시태그']}]},
  'layout.forms': {kind:'collection',tiers:[{css:'form'}]},
  'layout.tabPanels': {kind:'collection',tiers:[{css:'[role="tabpanel"]'}]},
  'layout.lists': {kind:'collection',scope:'layout.main',tiers:[{css:'[role="list"],ul,ol'}]},
  'notifications.panel': {kind:'container',tiers:[{css:'[role="dialog"],section,aside',contains:['소식','팔로우','댓글']}]},
  'announcements.items': {kind:'collection',scope:'layout.main',pages:['announcements'],tiers:[{css:'a[href^="/announcement/"]'}]},
  'profile.followers': {kind:'control',effect:'navigate',scope:'layout.main',pages:['profile'],tiers:[{css:'a[href*="/follow?"][href*="type=follower"]'}]},
  'profile.followings': {kind:'control',effect:'navigate',scope:'layout.main',pages:['profile'],tiers:[{css:'a[href*="/follow?"][href*="type=following"]'}]},
  'profile.badges': {kind:'control',effect:'navigate',scope:'layout.main',tiers:[{css:'a',path:'/profile/assignment'}]},
  'overlay.close': {kind:'control',effect:'local',tiers:[{css:'[role="dialog"] button,dialog[open] button',names:['닫기','Close']}]},
};
for (const [key,path] of Object.entries({home:'/',characters:'/characters',works:'/my',images:'/image/generate'})) {
  UI_MAP['nav.'+key]={kind:'control',effect:'navigate',tiers:[{css:'a',path,names:{home:['스토리'],characters:['캐릭터'],works:['내 작품'],images:['이미지']}[key]},{css:'a',path}]};
}
for(const [key,label] of Object.entries({announcements:'공지',subscriptions:'구독함',likes:'좋아요 목록',badges:'활동 배지',blocks:'차단 관리',settings:'설정',personalized:'개인 맞춤 설정',chatSettings:'채팅방 설정',invite:'친구 초대',coupon:'쿠폰 등록'})) {
  UI_MAP['menu.'+key]={kind:'control',scope:'profile.panel',effect:'navigate',tiers:[{css:'a,button,[role="menuitem"]',names:[label]}]};
}
const tabGroups={search:{pages:['search'],labels:['전체','스토리','시리즈','캐릭터','계정','해시태그']},profile:{pages:['profile'],labels:['작품','시리즈','피드']},blocks:{pages:['blocks'],labels:['스토리','캐릭터','제작자','해시태그']},notifications:{scope:'notifications.panel',labels:['전체','소식','좋아요','댓글','팔로우']}};
for(const [group,def] of Object.entries(tabGroups))for(const label of def.labels)UI_MAP[`${group}.tab.${label}`]={kind:'control',effect:'navigate',scope:def.scope??'layout.main',pages:def.pages,tiers:[{css:'[role="tab"]',names:[label]}]};
for(const label of ['전체','스토리','캐릭터','공개 여부','미등록','최신순'])UI_MAP['works.filter.'+label]={kind:'control',effect:'navigate',scope:'layout.main',pages:['works'],tiers:[{css:'button',names:[label]}]};
for(const label of ['기본 설정','플레이 가이드','대화 프로필','유저 노트','최대 출력량 조절','요약 메모리','키보드 단축키','글꼴'])UI_MAP['chat.settings.'+label]={kind:'control',effect:'local',scope:'layout.main',pages:['story-chat','character-chat'],tiers:[{css:'button',names:[label]}]};
for(const label of ['추천','취향저격','신규 랭킹','전체 랭킹','오늘 신작','남성 인기','SF/판타지','일상/현대','시뮬레이션','로맨스','GL','로판','무협','시대','기타','BL','여성 인기','2차 창작','유틸리티'])UI_MAP['home.category.'+label]={kind:'control',effect:'navigate',scope:'layout.main',pages:['home','characters'],tiers:[{css:'button',names:[label]}]};
for(const [key,names,effect] of [['send',['전송','메시지 보내기'],'paid'],['reroll',['재생성','다시 생성'],'paid'],['continue',['이어쓰기','계속 생성'],'paid']])UI_MAP['chat.'+key]={kind:'control',effect,scope:'layout.main',pages:['story-chat','character-chat'],tiers:[{css:'button',names}]};
for(const [key,names] of [['save',['저장','등록']],['delete',['삭제']],['post',['글쓰기']]])UI_MAP['action.'+key]={kind:'control',effect:'write',tiers:[{css:'button',names}]};
for(const label of ['프로필','스토리설정','시작설정','스탯설정','미디어','키워드북','단축어','엔딩설정','등록'])UI_MAP['builder.tab.'+label]={kind:'control',effect:'local',scope:'layout.main',pages:['builder'],tiers:[{css:'[role="tab"],button',names:[label,label+' *']}]};
