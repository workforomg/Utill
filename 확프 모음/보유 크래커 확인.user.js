// ==UserScript==
// @name         크래커 보유량 표시
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
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

  /*
   * 같은 완료 패킷이 여러 경로로 잡혔을 때
   * 중복 차감 방지 시간
   */
  const DEDUPE_TIME_MS =
    15_000;

  /*
   * 페이지 이동 API 요청이 너무 연속으로
   * 발생하지 않게 하는 짧은 지연
   */
  const PAGE_REFRESH_DELAY_MS =
    80;


  /*
   * =========================
   * 상태
   * =========================
   */

  let currentQuantity =
    null;

  let apiLoading =
    false;

  let apiRefreshPending =
    false;

  let renderScheduled =
    false;

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
   * 중요:
   *
   * - 토큰은 API 요청 직전에만 읽습니다.
   * - localStorage 등에 복사하지 않습니다.
   * - 전역 변수에 저장하지 않습니다.
   * - DOM에 출력하지 않습니다.
   * - console에도 출력하지 않습니다.
   */

  function getAccessToken() {
    try {
      const cookies =
        document.cookie
          .split(';');

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
          name !==
          'access_token'
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
          /*
           * URL 인코딩된 값이 아니면
           * 원본 그대로 사용
           */
        }

        /*
         * 쿠키 값 자체에 이미
         * Bearer 접두사가 붙어 있는 경우 제거.
         *
         * API 요청할 때 한 번만 붙입니다.
         */
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
      /*
       * 토큰이나 쿠키 내용을
       * 콘솔에 남기지 않음
       */
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
       * 기존 size-10 버튼은
       * width: 40px 형태이므로
       * 숫자가 들어갈 만큼만 확장
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
       * 크래커 아이콘 오른쪽 숫자
       */
      a.${HOST_CLASS}
      .${BADGE_CLASS} {
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
   * 잔액 UI
   * =========================
   */

  function renderBalance() {
    renderScheduled =
      false;

    injectStyle();

    const links =
      document.querySelectorAll(
        'a[href="/cracker"]'
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
          `.${BADGE_CLASS}`
        );

      if (!badge) {
        badge =
          document.createElement(
            'span'
          );

        badge.className =
          BADGE_CLASS;

        /*
         * 원래 SVG 뒤에 들어감
         *
         * [아이콘] 12,345
         */
        link.appendChild(
          badge
        );
      }

      if (
        currentQuantity ===
        null
      ) {
        badge.hidden =
          true;

        badge.textContent =
          '';

        continue;
      }

      badge.hidden =
        false;

      badge.textContent =
        formatNumber(
          currentQuantity
        );

      badge.setAttribute(
        'aria-label',
        `보유 크래커 ${formatNumber(
          currentQuantity
        )}`
      );
    }
  }


  function scheduleRender() {
    if (renderScheduled) {
      return;
    }

    renderScheduled =
      true;

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
     * 아직 최초 API 잔액을
     * 받지 못했다면 임의로 계산하지 않고
     * 서버 값을 가져옵니다.
     */
    if (
      currentQuantity ===
      null
    ) {
      requestQuantityRefresh();

      return;
    }

    currentQuantity =
      Math.max(
        0,
        currentQuantity -
        amount
      );

    scheduleRender();
  }


  /*
   * =========================
   * 크래커 잔액 API
   * =========================
   */

  async function refreshQuantity() {
    if (apiLoading) {
      apiRefreshPending =
        true;

      return;
    }

    apiLoading =
      true;

    /*
     * API 호출할 때마다
     * 최신 access_token을 다시 읽음.
     *
     * 토큰을 지속적으로 보관하지 않음.
     */
    const accessToken =
      getAccessToken();

    if (!accessToken) {
      apiLoading =
        false;

      return;
    }

    try {
      const response =
        await fetch(
          CASH_API,
          {
            method:
              'GET',

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
       * 에러 응답 본문이나
       * 헤더를 콘솔에 출력하지 않음.
       */
      if (!response.ok) {
        return;
      }

      const json =
        await response.json();

      /*
       * 예상:
       *
       * {
       *   "result": "SUCCESS",
       *   "data": {
       *     "quantity": 12345
       *   }
       * }
       */
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
       * 의도적으로 아무 내용도
       * 콘솔에 출력하지 않습니다.
       *
       * 특히 access_token 및
       * Authorization 정보는
       * 절대 기록하지 않습니다.
       */
    } finally {
      apiLoading =
        false;

      /*
       * API 요청 중에 추가 갱신 요청이
       * 들어왔으면 한 번 더 실행
       */
      if (apiRefreshPending) {
        apiRefreshPending =
          false;

        queueMicrotask(
          refreshQuantity
        );
      }
    }
  }


  /*
   * 페이지 이동 등에서 여러 번 호출되어도
   * 아주 짧게 합쳐서 한 번만 API 요청
   */
  let refreshTimer =
    null;

  function requestQuantityRefresh() {
    if (refreshTimer) {
      clearTimeout(
        refreshTimer
      );
    }

    refreshTimer =
      setTimeout(
        () => {
          refreshTimer =
            null;

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
      stableId !==
      undefined
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

    /*
     * 오래된 기록 삭제
     */
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
   * characterMessageGenerated
   * =========================
   */

  function handleSocketPacket(
    packet
  ) {
    if (
      !Array.isArray(packet) ||
      packet[0] !==
        TARGET_EVENT
    ) {
      return;
    }

    const envelope =
      packet[1];

    const data =
      envelope?.data ??
      envelope;

    /*
     * 메시지 생성 완료에서만
     * 실제 사용량 반영
     */
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
     * 팝업이나 별도 표시 없이
     * 상단 보유량 숫자만 즉시 차감
     */
    subtractQuantity(
      total
    );
  }


  /*
   * =========================
   * Socket.IO 패킷 추출
   * =========================
   */

  function extractTargetPackets(
    text
  ) {
    const needle =
      `["${TARGET_EVENT}"`;

    let searchIndex =
      0;

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

      let depth =
        0;

      let inString =
        false;

      let escaped =
        false;

      let end =
        -1;

      for (
        let index = start;
        index < text.length;
        index += 1
      ) {
        const character =
          text[index];

        if (inString) {
          if (escaped) {
            escaped =
              false;
          } else if (
            character === '\\'
          ) {
            escaped =
              true;
          } else if (
            character === '"'
          ) {
            inString =
              false;
          }

          continue;
        }

        if (
          character === '"'
        ) {
          inString =
            true;

          continue;
        }

        if (
          character === '['
        ) {
          depth +=
            1;
        }

        if (
          character === ']'
        ) {
          depth -=
            1;

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
        /*
         * 불완전한 패킷 무시
         */
      }

      searchIndex =
        end;
    }
  }


  /*
   * =========================
   * WebSocket 데이터 처리
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
   * 페이지 이동
   * =========================
   */

  function handlePageChange() {
    /*
     * SPA에서 다른 페이지로 이동할 때마다
     * 서버의 실제 잔액으로 다시 동기화
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
   * 최초 페이지 접속
   */
  requestQuantityRefresh();


  /*
   * React가 헤더를 통째로 다시 만들면
   * 크래커 숫자를 다시 삽입.
   *
   * URL 변경도 같이 확인.
   */
  new MutationObserver(
    () => {
      checkUrlChange();

      scheduleRender();
    }
  ).observe(
    document.documentElement,
    {
      childList:
        true,

      subtree:
        true,
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
         * document-start 시점에
         * 쿠키가 아직 준비되지 않았던 경우도
         * 여기서 한 번 더 조회
         */
        requestQuantityRefresh();
      },
      {
        once:
          true,
      }
    );
  } else {
    scheduleRender();
  }
})();
