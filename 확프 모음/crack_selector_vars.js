// Crack / Wrtn Tampermonkey selector variable list
// 계속 추가해서 쓰기 위한 지정자 변수 모음 파일입니다.
// 다른 템퍼몽키 스크립트에서 unsafeWindow.CrackSelectorVars 로 접근할 수 있습니다.
// @grant unsafeWindow 를 쓰는 스크립트라면 unsafeWindow.CrackSelectorVars
// @grant none 이라면 window.CrackSelectorVars 로 접근하세요.

(function exposeCrackSelectorVars() {
  'use strict';

  const rootWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  const CrackSelectorVars = {
    version: '2026-07-03.1',

    /**************************************************************************
     * 1. 작품 상세 페이지 - 공식 크리에이터 유무
     *
     * 판단 기준:
     * - 공식 크리에이터/배지 영역 안에 아래 xmlns 값을 가진 svg가 있으면 true로 판단.
     * - 없으면 document.querySelector(...) 결과가 null 이므로 false로 판단.
     **************************************************************************/
    workDetail: {
      officialCreatorSvgXmlnsValue: 'http://www.w3.org/2000/svg',
      officialCreatorSvgXmlnsSelector: 'svg[xmlns="http://www.w3.org/2000/svg"]',
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
  };

  /**************************************************************************
   * 선택 사항: 자주 쓸 간단 헬퍼
   **************************************************************************/
  CrackSelectorVars.helpers = {
    /** 작품 상세 페이지에서 공식 크리에이터 배지 svg 존재 여부 */
    hasOfficialCreator(root = document) {
      return !!root.querySelector(CrackSelectorVars.workDetail.officialCreatorSvgXmlnsSelector);
    },

    /** 스토리 리스트 root 찾기 */
    getStoryListRoot(root = document) {
      return root.querySelector(CrackSelectorVars.storyList.rootSelector);
    },

    /** 플레이한 스토리 리스트 가상 스크롤러 찾기 */
    getPlayedStoryVirtualScroller(root = document) {
      return root.querySelector(CrackSelectorVars.playedStoryList.virtualScrollerSelector);
    },
  };

  rootWindow.CrackSelectorVars = CrackSelectorVars;

  // ready 이벤트: 다른 스크립트가 이 파일 로딩 완료를 감지할 수 있게 함.
  document.dispatchEvent(new CustomEvent('CrackSelectorVarsReady', {
    detail: { CrackSelectorVars },
  }));
})();
