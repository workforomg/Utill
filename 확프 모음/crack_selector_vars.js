// Crack / Wrtn Tampermonkey selector variable list
// 계속 추가해서 쓰기 위한 지정자 변수 모음 파일입니다.
// 다른 템퍼몽키 스크립트에서 unsafeWindow.CrackSelectorVars 로 접근할 수 있습니다.
// @grant unsafeWindow 를 쓰는 스크립트라면 unsafeWindow.CrackSelectorVars
// @grant none 이라면 window.CrackSelectorVars 로 접근하세요.

(function exposeCrackSelectorVars() {
  'use strict';

  const rootWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  const CrackSelectorVars = {
    version: '2026-07-03.4',

    /**************************************************************************
     * 1. 작품 상세 페이지 - 공식 크리에이터 유무 / 작품 이름
     *
     * 공식 크리에이터 판단 기준:
     * - 공식 크리에이터/배지 영역 안에 아래 xmlns 값을 가진 svg가 있으면 true로 판단.
     * - 없으면 document.querySelector(...) 결과가 null 이므로 false로 판단.
     **************************************************************************/
    workDetail: {
      /** 공식 크리에이터 svg xmlns 값 */
      officialCreatorSvgXmlnsValue: 'http://www.w3.org/2000/svg',

      /** 공식 크리에이터 svg 유무 확인용 */
      officialCreatorSvgXmlnsSelector: 'svg[xmlns="http://www.w3.org/2000/svg"]',

      /** 작품 상세 페이지 작품 이름 p 태그 */
      titleSelector: 'a[href^="/detail/"] > p.typo-text-lg_leading-paragraph_semibold',

      /** 작품 상세 페이지 작품 이름 링크 */
      titleLinkSelector: 'a[href^="/detail/"]:has(> p.typo-text-lg_leading-paragraph_semibold)',
    },

    /**************************************************************************
     * 2. 스토리 리스트 root
     **************************************************************************/
    storyList: {
      rootSelector: String.raw`#__next > div > div.relative.flex.h-full > div.hidden.h-full.shrink-0.overflow-hidden.bg-surface_tertiary.md\:block.transition-\[width\].duration-300.ease-\[cubic-bezier\(0\.25\,0\.1\,0\.25\,1\)\].w-\[260px\] > div > div > div.flex.flex-col.w-full.h-full.min-h-full.overflow-hidden.sticky.top-0 > div.relative.flex-1.min-h-0.flex.flex-col > div > div > div > div > div:nth-child(2) > div:nth-child(1)`,
    },

    /**************************************************************************
     * 3. 플레이한 스토리 리스트 - 가상 스크롤 타겟
     **************************************************************************/
    playedStoryList: {
      virtualScrollerSelector: '[data-testid="virtuoso-scroller"][data-virtuoso-scroller="true"], [data-virtuoso-scroller="true"], [data-testid="virtuoso-scroller"]',
    },

    /**************************************************************************
     * 4. 누적 랭킹 영역
     **************************************************************************/
    cumulative: {
      /** 누적 랭킹 버튼 */
      triggerSelector: String.raw`#radix-\:rv\:-trigger-cumulative`,

      /** 내 누적 랭킹 영역 */
      myRankingContainerSelector: String.raw`#radix-\:rv\:-content-cumulative > div.mt-2.flex.flex-col.gap-3 > div.flex.flex-col.gap-1\.5`,

      /** 누적 순위 span */
      rankSelector: 'span.min-w-5.shrink-0.text-center.text-muted-foreground.typo-text-sm_leading-none_semibold',

      /** 총 채팅 횟수 span */
      totalChatCountSelector: String.raw`span.shrink-0.rounded.px-1\.5.py-1.text-text_secondary.typo-text-xs_leading-none_semibold.bg-surface_tertiary`,
    },
  };

  /**************************************************************************
   * 선택 사항: 자주 쓸 간단 헬퍼
   **************************************************************************/
  CrackSelectorVars.helpers = {
    /** 작품 상세 페이지에서 공식 크리에이터 배지 svg 존재 여부 */
    hasOfficialCreator(root = document) {
      return !!root.querySelector(CrackSelectorVars.workDetail.officialCreatorSvgXmlnsSelector);
    },

    /** 작품 상세 페이지 작품 이름 요소 찾기 */
    getWorkDetailTitleElement(root = document) {
      return root.querySelector(CrackSelectorVars.workDetail.titleSelector);
    },

    /** 작품 상세 페이지 작품 이름 텍스트 가져오기 */
    getWorkDetailTitle(root = document) {
      const el = CrackSelectorVars.helpers.getWorkDetailTitleElement(root);
      return el ? el.textContent.trim() : '';
    },

    /** 작품 상세 페이지 작품 이름 링크 찾기 */
    getWorkDetailTitleLink(root = document) {
      return root.querySelector(CrackSelectorVars.workDetail.titleLinkSelector);
    },

    /** 스토리 리스트 root 찾기 */
    getStoryListRoot(root = document) {
      return root.querySelector(CrackSelectorVars.storyList.rootSelector);
    },

    /** 플레이한 스토리 리스트 가상 스크롤러 찾기 */
    getPlayedStoryVirtualScroller(root = document) {
      return root.querySelector(CrackSelectorVars.playedStoryList.virtualScrollerSelector);
    },

    /** 누적 랭킹 버튼 찾기 */
    getCumulativeTrigger(root = document) {
      return root.querySelector(CrackSelectorVars.cumulative.triggerSelector);
    },

    /** 내 누적 랭킹 영역 찾기 */
    getMyCumulativeRankingContainer(root = document) {
      return root.querySelector(CrackSelectorVars.cumulative.myRankingContainerSelector);
    },

    /** 누적 순위 요소 찾기 */
    getCumulativeRankElement(root = document) {
      const scope = CrackSelectorVars.helpers.getMyCumulativeRankingContainer(root) || root;
      return scope.querySelector(CrackSelectorVars.cumulative.rankSelector);
    },

    /** 누적 순위 텍스트 가져오기 */
    getCumulativeRank(root = document) {
      const el = CrackSelectorVars.helpers.getCumulativeRankElement(root);
      return el ? el.textContent.trim() : '';
    },

    /** 총 채팅 횟수 요소 찾기 */
    getTotalChatCountElement(root = document) {
      const scope = CrackSelectorVars.helpers.getMyCumulativeRankingContainer(root) || root;
      return scope.querySelector(CrackSelectorVars.cumulative.totalChatCountSelector);
    },

    /** 총 채팅 횟수 텍스트 가져오기 */
    getTotalChatCount(root = document) {
      const el = CrackSelectorVars.helpers.getTotalChatCountElement(root);
      return el ? el.textContent.trim() : '';
    },
  };

  rootWindow.CrackSelectorVars = CrackSelectorVars;

  // ready 이벤트: 다른 스크립트가 이 파일 로딩 완료를 감지할 수 있게 함.
  document.dispatchEvent(new CustomEvent('CrackSelectorVarsReady', {
    detail: { CrackSelectorVars },
  }));
})();
