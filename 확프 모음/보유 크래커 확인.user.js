// ==UserScript==
// @name         크래커 보유량 표시
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.5
// @author       지유지요
// @description  API에서 보유량을 읽고 /cracker 아이콘 오른쪽에 표시합니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  /*
   * =========================
   * 설정
   * =========================
   */

  const CASH_API =
    'https://crack-api.wrtn.ai/crack-cash/cash';

  const TARGET_EVENT =
    'characterMessageGenerated';

  const STYLE_ID =
    'crack-cracker-balance-style';

  const BADGE_CLASS =
    'crack-cracker-balance-value';

  const HOST_CLASS =
    'crack-cracker-balance-host';

  const DEDUPE_TIME_MS =
    15_000;

  const PAGE_REFRESH_DELAY_MS =
    80;


  /*
   * =========================
   * 상태
   * =========================
   */

  let currentQuantity = null;

  let apiLoading = false;

  let apiRefreshPending = false;

  let renderScheduled = false;

  let refreshTimer = null;

  let lastUrl =
    location.href;

  const seenResponses =
    new Map();


  /*
   * =========================
   * 숫자 처리
   * =========================
   */

  function normalizeNumber(value) {
    const number =
      Number(value);

    if (
      !Number.isFinite(number)
    ) {
      return null;
    }

    return Math.max(
      0,
      number
    );
  }


  function formatNumber(value) {
    return Number(value)
      .toLocaleString(
        'ko-KR',
        {
          maximumFractionDigits: 6,
        }
      );
  }


  /*
   * =========================
   * access_token
   * =========================
   *
   * 토큰은:
   *
   * - 콘솔 출력 안 함
   * - DOM 출력 안 함
   * - localStorage 저장 안 함
   * - sessionStorage 저장 안 함
   * - 전역 변수 저장 안 함
   *
   * API 호출 직전에만 읽어서 사용
   */

  function getAccessToken() {
    try {
      const cookies =
        document.cookie.split(';');

      for (
        const rawCookie
        of cookies
      ) {
        const cookie =
          rawCookie.trim();

        const separatorIndex =
          cookie.indexOf('=');

        if (
          separatorIndex === -1
        ) {
          continue;
        }

        const name =
          cookie
            .slice(
              0,
              separatorIndex
            )
            .trim();

        if (
          name !== 'access_token'
        ) {
          continue;
        }

        let value =
          cookie.slice(
            separatorIndex + 1
          );

        try {
          value =
            decodeURIComponent(
              value
            );
        } catch {
          // 인코딩되지 않은 값이면 그대로 사용
        }

        value =
          value
            .replace(
              /^Bearer\s+/i,
              ''
            )
            .trim();

        if (!value) {
          return null;
        }

        return value;
      }
    } catch {
      // 토큰 관련 정보 출력하지 않음
    }

    return null;
  }


  /*
   * =========================
   * 스타일
   * =========================
   */

  function injectStyle() {
    if (
      document.getElementById(
        STYLE_ID
      )
    ) {
      return;
    }

    const style =
      document.createElement(
        'style'
      );

    style.id =
      STYLE_ID;

    style.textContent = `
      /*
       * 상단 크래커 아이콘 버튼만 확장
       */
      a.${HOST_CLASS} {
        width: auto !important;
        min-width: 40px !important;

        padding-left: 8px !important;
        padding-right: 8px !important;

        gap: 5px !important;

        overflow: visible !important;
      }

      /*
       * 추가하는 보유량 숫자
       */
      a.${HOST_CLASS}
      > .${BADGE_CLASS} {
        display: inline-flex;
        align-items: center;
        justify-content: center;

        flex: 0 0 auto;

        color: #FFA600;

        font-family:
          Pretendard,
          -apple-system,
          BlinkMacSystemFont,
          "Segoe UI",
          sans-serif;

        font-size: 13px;
        line-height: 1;
        font-weight: 700;

        letter-spacing: -0.02em;

        white-space: nowrap;

        pointer-events: none;
      }
    `;

    (
      document.head ||
      document.documentElement
    ).appendChild(
      style
    );
  }


  /*
   * =========================
   * 우리가 수정할 상단 버튼 판별
   * =========================
   *
   * 대상:
   *
   * <a href="/cracker">
   *   <svg ...></svg>
   * </a>
   *
   * 제외:
   *
   * <a href="/cracker">
   *   <div ...>
   *     <svg ...></svg>
   *     <span>612,938</span>
   *   </div>
   * </a>
   */

  function isTargetCrackerLink(link) {
    if (
      !link ||
      link.tagName !== 'A'
    ) {
      return false;
    }

    if (
      link.getAttribute('href') !==
      '/cracker'
    ) {
      return false;
    }

    /*
     * 상단 아이콘은 SVG가
     * a의 직접 자식이어야 함
     */
    const directSvg =
      link.querySelector(
        ':scope > svg'
      );

    if (!directSvg) {
      return false;
    }

    /*
     * div를 직접 자식으로 가진 구조는
     * 크래커 페이지 내부 UI이므로 제외
     */
    if (
      link.querySelector(
        ':scope > div'
      )
    ) {
      return false;
    }

    /*
     * 사이트 자체 잔액 텍스트가 있으면 제외
     */
    if (
      link.querySelector(
        '.typo-text-sm_leading-none_medium'
      )
    ) {
      return false;
    }

    return true;
  }


  function getTargetCrackerLinks() {
    return [
      ...document.querySelectorAll(
        'a[href="/cracker"]'
      ),
    ].filter(
      isTargetCrackerLink
    );
  }


  /*
   * =========================
   * 잘못 붙은 기존 UI 제거
   * =========================
   */

  function cleanupInvalidBadges(
    validLinks
  ) {
    document
      .querySelectorAll(
        `a[href="/cracker"] > .${BADGE_CLASS}`
      )
      .forEach(
        badge => {
          const link =
            badge.parentElement;

          if (
            !validLinks.includes(link)
          ) {
            badge.remove();

            link?.classList.remove(
              HOST_CLASS
            );
          }
        }
      );


    /*
     * badge는 없는데
     * 이전 버전이 HOST_CLASS만 남겼을 경우도 제거
     */
    document
      .querySelectorAll(
        `a.${HOST_CLASS}[href="/cracker"]`
      )
      .forEach(
        link => {
          if (
            !validLinks.includes(link)
          ) {
            link.classList.remove(
              HOST_CLASS
            );
          }
        }
      );
  }


  /*
   * =========================
   * 잔액 UI
   * =========================
   */

  function renderBalance() {
    renderScheduled = false;

    injectStyle();

    const links =
      getTargetCrackerLinks();

    cleanupInvalidBadges(
      links
    );

    if (!links.length) {
      return;
    }

    for (
      const link
      of links
    ) {
      link.classList.add(
        HOST_CLASS
      );

      let badge =
        link.querySelector(
          `:scope > .${BADGE_CLASS}`
        );

      if (!badge) {
        badge =
          document.createElement(
            'span'
          );

        badge.className =
          BADGE_CLASS;

        /*
         * SVG 바로 뒤에 추가
         *
         * [크래커 아이콘] 612,938
         */
        link.appendChild(
          badge
        );
      }

      if (
        currentQuantity === null
      ) {
        badge.hidden = true;
        badge.textContent = '';

        continue;
      }

      const formatted =
        formatNumber(
          currentQuantity
        );

      badge.hidden = false;

      badge.textContent =
        formatted;

      badge.setAttribute(
        'aria-label',
        `보유 크래커 ${formatted}`
      );
    }
  }


  function scheduleRender() {
    if (renderScheduled) {
      return;
    }

    renderScheduled = true;

    requestAnimationFrame(
      renderBalance
    );
  }


  /*
   * =========================
   * 현재 잔액
   * =========================
   */

  function setQuantity(value) {
    const quantity =
      normalizeNumber(
        value
      );

    if (
      quantity === null
    ) {
      return;
    }

    currentQuantity =
      quantity;

    scheduleRender();
  }


  function subtractQuantity(value) {
    const amount =
      normalizeNumber(
        value
      );

    if (
      amount === null ||
      amount <= 0
    ) {
      return;
    }

    /*
     * 아직 실제 서버 잔액을
     * 받은 적이 없으면
     * 임의 계산하지 않음
     */
    if (
      currentQuantity === null
    ) {
      requestQuantityRefresh();

      return;
    }

    currentQuantity =
      Math.max(
        0,
        currentQuantity - amount
      );

    scheduleRender();
  }


  /*
   * =========================
   * 잔액 API
   * =========================
   */

  async function refreshQuantity() {
    if (apiLoading) {
      apiRefreshPending = true;

      return;
    }

    apiLoading = true;

    /*
     * 함수 내부에서만 토큰 보관
     */
    const accessToken =
      getAccessToken();

    if (!accessToken) {
      apiLoading = false;

      return;
    }

    try {
      const response =
        await fetch(
          CASH_API,
          {
            method: 'GET',

            credentials:
              'include',

            cache:
              'no-store',

            headers: {
              Accept:
                'application/json',

              Authorization:
                `Bearer ${accessToken}`,
            },
          }
        );

      /*
       * response 내용,
       * headers,
       * Authorization 등을
       * console에 출력하지 않음
       */
      if (!response.ok) {
        return;
      }

      const json =
        await response.json();

      const quantity =
        normalizeNumber(
          json?.data?.quantity
        );

      if (
        quantity === null
      ) {
        return;
      }

      setQuantity(
        quantity
      );

    } catch {
      /*
       * API 오류도 console 출력 없음
       */
    } finally {
      apiLoading = false;

      if (
        apiRefreshPending
      ) {
        apiRefreshPending =
          false;

        queueMicrotask(
          refreshQuantity
        );
      }
    }
  }


  /*
   * =========================
   * API 요청 디바운스
   * =========================
   */

  function requestQuantityRefresh() {
    if (refreshTimer) {
      clearTimeout(
        refreshTimer
      );
    }

    refreshTimer =
      setTimeout(
        () => {
          refreshTimer = null;

          refreshQuantity();
        },
        PAGE_REFRESH_DELAY_MS
      );
  }


  /*
   * =========================
   * 중복 차감 방지
   * =========================
   */

  function firstDefined(
    ...values
  ) {
    return values.find(
      value =>
        value !== undefined &&
        value !== null &&
        value !== ''
    );
  }


  function makeResponseKey(
    data,
    total
  ) {
    const stableId =
      firstDefined(
        data.id,
        data._id,
        data.messageId,
        data.characterMessageId,
        data.generatedMessageId,
        data.chatMessageId,
        data.message?.id,
        data.message?._id
      );

    if (
      stableId !== undefined
    ) {
      return (
        `id:${stableId}:${total}`
      );
    }

    const content =
      String(
        data.content ??
        data.message?.content ??
        ''
      );

    const time =
      firstDefined(
        data.createdAt,
        data.updatedAt,
        data.completedAt,
        ''
      );

    const chatId =
      firstDefined(
        data.chatId,
        data.roomId,
        data.characterId,
        ''
      );

    return [
      'fallback',
      chatId,
      time,
      total,
      content.length,
      content.slice(
        0,
        80
      ),
      content.slice(
        -80
      ),
    ].join('|');
  }


  function isDuplicateResponse(
    data,
    total
  ) {
    const now =
      Date.now();

    const key =
      makeResponseKey(
        data,
        total
      );

    for (
      const [
        savedKey,
        savedTime,
      ]
      of seenResponses
    ) {
      if (
        now - savedTime >
        DEDUPE_TIME_MS
      ) {
        seenResponses.delete(
          savedKey
        );
      }
    }

    const previousTime =
      seenResponses.get(
        key
      );

    if (
      previousTime &&
      now - previousTime <=
        DEDUPE_TIME_MS
    ) {
      return true;
    }

    seenResponses.set(
      key,
      now
    );

    return false;
  }


  /*
   * =========================
   * 메시지 차감 처리
   * =========================
   */

  function handleSocketPacket(
    packet
  ) {
    if (
      !Array.isArray(packet) ||
      packet[0] !== TARGET_EVENT
    ) {
      return;
    }

    const envelope =
      packet[1];

    const data =
      envelope?.data ??
      envelope;

    if (
      !data ||
      data.status !== 'end'
    ) {
      return;
    }

    const cashUsage =
      data.cashUsage ??
      data.cashusage ??
      envelope?.cashUsage;

    const total =
      Number(
        cashUsage?.total
      );

    if (
      !Number.isFinite(total) ||
      total <= 0
    ) {
      return;
    }

    if (
      isDuplicateResponse(
        data,
        total
      )
    ) {
      return;
    }

    /*
     * 별도 팝업 없음.
     * 숫자만 즉시 차감.
     */
    subtractQuantity(
      total
    );
  }


  /*
   * =========================
   * Socket.IO 배열 추출
   * =========================
   */

  function extractTargetPackets(
    text
  ) {
    const needle =
      `["${TARGET_EVENT}"`;

    let searchIndex = 0;

    while (
      searchIndex <
      text.length
    ) {
      const start =
        text.indexOf(
          needle,
          searchIndex
        );

      if (
        start === -1
      ) {
        break;
      }

      let depth = 0;
      let inString = false;
      let escaped = false;
      let end = -1;

      for (
        let index = start;
        index < text.length;
        index += 1
      ) {
        const character =
          text[index];

        if (inString) {
          if (escaped) {
            escaped = false;

          } else if (
            character === '\\'
          ) {
            escaped = true;

          } else if (
            character === '"'
          ) {
            inString = false;
          }

          continue;
        }

        if (
          character === '"'
        ) {
          inString = true;

          continue;
        }

        if (
          character === '['
        ) {
          depth += 1;
        }

        if (
          character === ']'
        ) {
          depth -= 1;

          if (
            depth === 0
          ) {
            end =
              index + 1;

            break;
          }
        }
      }

      if (
        end === -1
      ) {
        break;
      }

      try {
        const packet =
          JSON.parse(
            text.slice(
              start,
              end
            )
          );

        handleSocketPacket(
          packet
        );
      } catch {
        // 불완전한 패킷 무시
      }

      searchIndex =
        end;
    }
  }


  /*
   * =========================
   * WebSocket 데이터
   * =========================
   */

  function consumeIncoming(
    rawData
  ) {
    if (
      typeof rawData ===
      'string'
    ) {
      if (
        rawData.includes(
          TARGET_EVENT
        )
      ) {
        extractTargetPackets(
          rawData
        );
      }

      return;
    }

    if (
      rawData instanceof Blob
    ) {
      rawData
        .text()
        .then(
          consumeIncoming
        )
        .catch(
          () => {}
        );

      return;
    }

    if (
      rawData instanceof
      ArrayBuffer
    ) {
      consumeIncoming(
        new TextDecoder()
          .decode(
            rawData
          )
      );

      return;
    }

    if (
      ArrayBuffer.isView(
        rawData
      )
    ) {
      consumeIncoming(
        new TextDecoder()
          .decode(
            new Uint8Array(
              rawData.buffer,
              rawData.byteOffset,
              rawData.byteLength
            )
          )
      );
    }
  }


  /*
   * =========================
   * WebSocket 후킹
   * =========================
   */

  function hookWebSocket() {
    const OriginalWebSocket =
      window.WebSocket;

    if (
      typeof OriginalWebSocket !==
      'function'
    ) {
      return;
    }

    window.WebSocket =
      new Proxy(
        OriginalWebSocket,
        {
          construct(
            Target,
            args,
            NewTarget
          ) {
            const socket =
              Reflect.construct(
                Target,
                args,
                NewTarget
              );

            socket.addEventListener(
              'message',
              event => {
                consumeIncoming(
                  event.data
                );
              }
            );

            return socket;
          },
        }
      );
  }


  /*
   * =========================
   * 페이지 이동 감지
   * =========================
   */

  function handlePageChange() {
    /*
     * 페이지 이동할 때마다
     * 서버 실제 보유량 재확인
     */
    requestQuantityRefresh();

    scheduleRender();
  }


  function checkUrlChange() {
    const currentUrl =
      location.href;

    if (
      currentUrl ===
      lastUrl
    ) {
      return;
    }

    lastUrl =
      currentUrl;

    handlePageChange();
  }


  function hookHistory() {
    const originalPushState =
      history.pushState;

    const originalReplaceState =
      history.replaceState;


    history.pushState =
      function (...args) {
        const result =
          originalPushState.apply(
            this,
            args
          );

        queueMicrotask(
          checkUrlChange
        );

        return result;
      };


    history.replaceState =
      function (...args) {
        const result =
          originalReplaceState.apply(
            this,
            args
          );

        queueMicrotask(
          checkUrlChange
        );

        return result;
      };


    window.addEventListener(
      'popstate',
      () => {
        queueMicrotask(
          checkUrlChange
        );
      }
    );
  }


  /*
   * =========================
   * 초기화
   * =========================
   */

  hookWebSocket();

  hookHistory();

  injectStyle();


  /*
   * 최초 잔액 조회
   */
  requestQuantityRefresh();


  /*
   * React가 헤더를 갈아끼우는 경우 대응
   */
  new MutationObserver(
    () => {
      checkUrlChange();

      scheduleRender();
    }
  ).observe(
    document.documentElement,
    {
      childList: true,
      subtree: true,
    }
  );


  if (
    document.readyState ===
    'loading'
  ) {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        scheduleRender();

        /*
         * document-start 직후
         * 토큰 접근이 안 됐을 가능성 대비
         */
        requestQuantityRefresh();
      },
      {
        once: true,
      }
    );

  } else {
    scheduleRender();
  }

})();
