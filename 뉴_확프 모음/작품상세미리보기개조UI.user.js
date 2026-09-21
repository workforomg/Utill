// ==UserScript==
// @name         작품 상세 미리보기 개조 UI
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%9E%91%ED%92%88%EC%83%81%EC%84%B8%EB%AF%B8%EB%A6%AC%EB%B3%B4%EA%B8%B0%EA%B0%9C%EC%A1%B0UI.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EC%9E%91%ED%92%88%EC%83%81%EC%84%B8%EB%AF%B8%EB%A6%AC%EB%B3%B4%EA%B8%B0%EA%B0%9C%EC%A1%B0UI.user.js
// @author       지유지요
// @description  스토리·캐릭터 상세를 2단으로 확장하고 정보·웹툰 탭을 자동 적용합니다.
// @match        https://crack.wrtn.ai/*
// @require      https://raw.githubusercontent.com/workforomg/Utill/main/dist/ui.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  "use strict";
  if (document.getElementById("crack-detail-ui-style")) return;
  if (typeof CrackUI === "undefined") {
    console.error("[크랙 상세 UI] @require의 dist/ui.js를 불러오지 못했습니다.");
    return;
  }
  const ui = CrackUI.createPageUI();
  const watchedDetailImages = new WeakSet();
  const DETAIL_TABS = [["detail", "상세보기"], ["series", "시리즈"], ["ranking", "랭킹"], ["similar", "비슷한 스토리"]];
  const WEBTOON_TAB = ["webtoon", "프롤로그 웹툰"];
  const style = document.createElement("style");
  style.id = "crack-detail-ui-style";
  style.textContent = `
[data-cdu-dialog] {
  --cdu-accent: #ef4138;
  --cdu-panel: var(--color-surface, #18181a);
  --cdu-border: color-mix(in srgb, currentColor 13%, transparent);
}
[data-cdu-detail-content="true"] > .cdu-detail-tabs {
  position: sticky;
  top: 0;
  z-index: 12;
  display: grid;
  grid-template-columns: repeat(var(--cdu-detail-tab-count, 4), minmax(0, 1fr));
  gap: 4px;
  margin: 0 20px 20px;
  padding: 5px;
  border: 1px solid var(--cdu-border);
  border-radius: 13px;
  background: color-mix(in srgb, var(--cdu-panel) 94%, transparent);
  box-shadow: 0 10px 26px rgba(0, 0, 0, .18);
  backdrop-filter: blur(18px);
}

[data-cdu-detail-content="true"] > .cdu-detail-tabs button {
  min-width: 0;
  min-height: 38px;
  padding: 8px 10px;
  border: 0;
  border-radius: 9px;
  color: color-mix(in srgb, currentColor 62%, transparent);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 750;
  transition: color .16s ease, background .16s ease, box-shadow .16s ease;
}

[data-cdu-detail-content="true"] > .cdu-detail-tabs button:hover {
  color: inherit;
  background: color-mix(in srgb, currentColor 6%, transparent);
}

[data-cdu-detail-content="true"] > .cdu-detail-tabs button[aria-selected="true"] {
  color: #fff;
  background: var(--cdu-accent);
  box-shadow: 0 5px 14px color-mix(in srgb, var(--cdu-accent) 28%, transparent);
}

[data-cdu-detail-content="true"] > .cdu-detail-tabs button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--cdu-accent) 72%, #fff);
  outline-offset: 2px;
}

[data-cdu-detail-content="true"][data-cdu-active-detail-tab="detail"]
  > [data-cdu-detail-pane]:not([data-cdu-detail-pane="detail"]),
[data-cdu-detail-content="true"][data-cdu-active-detail-tab="series"]
  > [data-cdu-detail-pane]:not([data-cdu-detail-pane="series"]),
[data-cdu-detail-content="true"][data-cdu-active-detail-tab="ranking"]
  > [data-cdu-detail-pane]:not([data-cdu-detail-pane="ranking"]),
[data-cdu-detail-content="true"][data-cdu-active-detail-tab="similar"]
  > [data-cdu-detail-pane]:not([data-cdu-detail-pane="similar"]),
[data-cdu-detail-content="true"][data-cdu-active-detail-tab="webtoon"]
  > [data-cdu-detail-pane]:not([data-cdu-detail-pane="webtoon"]) {
  display: none !important;
}

[data-cdu-webtoon-source="true"] {
  display: none !important;
}

.cdu-webtoon-jump {
  display: flex;
  width: 100%;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin: 14px 0;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--cdu-accent) 36%, var(--cdu-border));
  border-radius: 13px;
  color: inherit;
  background: color-mix(in srgb, var(--cdu-accent) 10%, transparent);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  font-weight: 800;
  transition: border-color .16s ease, background .16s ease, transform .16s ease;
}

.cdu-webtoon-jump:hover {
  border-color: color-mix(in srgb, var(--cdu-accent) 70%, transparent);
  background: color-mix(in srgb, var(--cdu-accent) 16%, transparent);
  transform: translateY(-1px);
}

.cdu-webtoon-jump:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--cdu-accent) 72%, #fff);
  outline-offset: 2px;
}

[data-cdu-detail-content="true"] > .cdu-webtoon-pane {
  min-width: 0;
}

.cdu-webtoon-title {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 800;
}

.cdu-webtoon-canvas {
  width: min(100%, 720px);
  margin: 0 auto;
  overflow: hidden;
  border-radius: 12px;
  background: #0b0b0c;
}

.cdu-webtoon-image {
  display: block !important;
  width: 100% !important;
  height: auto !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  object-fit: contain !important;
}

[data-cdu-detail-content="true"] > .cdu-detail-empty {
  display: flex;
  min-height: 180px;
  align-items: center;
  justify-content: center;
  margin: 0 20px 24px;
  border: 1px dashed var(--cdu-border);
  border-radius: 14px;
  color: color-mix(in srgb, currentColor 56%, transparent);
  font-size: 13px;
}

@media (min-width: 900px) {
  [data-cdu-dialog] > div:last-child {
    width: min(1120px, calc(100vw - 48px)) !important;
    height: min(880px, calc(100dvh - 48px)) !important;
    max-width: calc(100vw - 48px) !important;
    max-height: calc(100dvh - 48px) !important;
    overflow: hidden !important;
  }

  [data-cdu-dialog-body="true"] {
    display: grid !important;
    grid-template-columns: minmax(300px, 360px) minmax(0, 1fr) !important;
    align-items: start !important;
    flex: 1 1 auto !important;
    min-height: 0 !important;
    overflow-y: auto !important;
    overscroll-behavior: contain;
  }

  [data-cdu-dialog-body="true"] > :first-child {
    position: sticky !important;
    top: 0 !important;
    z-index: 2;
    flex-direction: column !important;
    align-items: stretch !important;
    gap: 18px !important;
    min-width: 0 !important;
    padding: 24px !important;
    background: var(--cdu-panel);
    backdrop-filter: blur(18px);
  }

  [data-cdu-dialog-body="true"] > :nth-child(2) {
    min-width: 0 !important;
    box-sizing: border-box !important;
    padding: 20px 32px 48px !important;
    border-left: 1px solid var(--cdu-border);
  }

  [data-cdu-detail-content="true"] > :not(.cdu-detail-tabs) {
    box-sizing: border-box !important;
    min-width: 0 !important;
    width: auto !important;
    max-width: 100% !important;
    margin-inline: 0 !important;
  }
}

@media (max-width: 899px) {
  [data-cdu-detail-content="true"] > .cdu-detail-tabs {
    grid-template-columns: none;
    grid-auto-flow: column;
    grid-auto-columns: minmax(110px, 1fr);
    overflow-x: auto;
    margin: 0 12px 16px;
    scrollbar-width: none;
  }

  [data-cdu-detail-content="true"] > .cdu-detail-tabs::-webkit-scrollbar {
    display: none;
  }

}

@media (min-width: 900px) {
  [data-cdu-detail-content="true"] > .cdu-detail-tabs {
    margin-inline: 0 !important;
  }
  [data-cdu-dialog-body="true"] > :nth-child(2) img {
    max-width: 100% !important;
    height: auto !important;
    box-sizing: border-box !important;
  }
}
`;
  document.head.append(style);

  function isDetailDivider(element) {
    const className = typeof element?.className === "string" ? element.className : "";
    return (className.includes("bg-border") && className.includes("h-[1px]")) ||
      (className.includes("border-t") && element.children.length === 0);
  }

  function detailLabels(element) {
    return Array.from(element.querySelectorAll("h1, h2, h3, h4, p, span"))
      .map((candidate) => (candidate.textContent || "").trim())
      .filter(Boolean);
  }

  function detailPaneFor(element) {
    const labels = detailLabels(element);

    if (labels.includes("이 스토리와 비슷해요") || labels.includes("비슷한 스토리")) return "similar";
    if (labels.includes("사용자 랭킹")) return "ranking";
    if (labels.includes("시리즈")) return "series";
    return "detail";
  }

  function setActiveDetailTab(content, key, { focus = false } = {}) {
    const tablist = content.querySelector(":scope > .cdu-detail-tabs");
    const available = Array.from(tablist?.querySelectorAll("[role='tab']") || [])
      .map((tab) => tab.dataset.cduDetailTab);
    const active = available.includes(key) ? key : "detail";
    content.dataset.cduActiveDetailTab = active;

    tablist?.querySelectorAll("[role='tab']").forEach((tab) => {
      const selected = tab.dataset.cduDetailTab === active;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus({ preventScroll: true });
    });

    content.querySelectorAll(":scope > [data-cdu-detail-pane]").forEach((pane) => {
      const visible = pane.dataset.cduDetailPane === active;
      pane.setAttribute("aria-hidden", String(!visible));
      if (visible) pane.removeAttribute("inert");
      else pane.setAttribute("inert", "");
    });
  }

  function createDetailTabs(content, body, tabs) {
    let tablist = content.querySelector(":scope > .cdu-detail-tabs");
    if (!tablist) {
      tablist = document.createElement("div");
      tablist.className = "cdu-detail-tabs";
      tablist.dataset.cduDetailTabs = "true";
      tablist.setAttribute("role", "tablist");
      tablist.setAttribute("aria-label", "스토리 정보 구역");

      tablist.addEventListener("click", (event) => {
        const button = event.target.closest("[data-cdu-detail-tab]");
        if (!button) return;
        setActiveDetailTab(content, button.dataset.cduDetailTab);
        body.scrollTo({ top: 0, behavior: "smooth" });
      });

      tablist.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        const buttons = Array.from(tablist.querySelectorAll("[role='tab']"));
        const current = buttons.indexOf(event.target);
        if (current < 0) return;
        event.preventDefault();
        const direction = event.key === "ArrowRight" ? 1 : -1;
        const next = buttons[(current + direction + buttons.length) % buttons.length];
        setActiveDetailTab(content, next.dataset.cduDetailTab, { focus: true });
        body.scrollTo({ top: 0, behavior: "smooth" });
      });

      content.prepend(tablist);
    }

    const signature = tabs.map(([key, label]) => `${key}:${label}`).join("|");
    if (tablist.dataset.cduTabSignature !== signature) {
      tablist.replaceChildren();
      for (const [key, label] of tabs) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("role", "tab");
        button.dataset.cduDetailTab = key;
        button.textContent = label;
        tablist.append(button);
      }
      tablist.dataset.cduTabSignature = signature;
      tablist.style.setProperty("--cdu-detail-tab-count", String(tabs.length));
    }

    return tablist;
  }

  function originalImageHeight(image) {
    const attributeHeight = Number.parseFloat(image.getAttribute("height") || "0");
    return image.naturalHeight || attributeHeight;
  }

  function isLongStoryImage(image) {
    return originalImageHeight(image) >= 4000;
  }

  function collectLongStoryImages(children) {
    const images = [];
    for (const child of children) {
      if (child.dataset.cduDetailPane !== "detail" || !detailLabels(child).includes("상세 설명")) continue;
      for (const image of child.querySelectorAll("img")) {
        if (!image.complete && !watchedDetailImages.has(image)) {
          watchedDetailImages.add(image);
          image.addEventListener("load", scheduleScan, { once: true });
        }
        if (isLongStoryImage(image)) images.push(image);
      }
    }
    return images;
  }

  function webtoonSourceTarget(image, content) {
    let target = image;
    for (let depth = 0; depth < 2; depth += 1) {
      const parent = target.parentElement;
      if (!parent || parent === content || parent.parentElement === content) break;
      if (parent.children.length !== 1 || (parent.textContent || "").trim()) break;
      target = parent;
    }
    return target;
  }

  function syncWebtoonPane(content, body, images) {
    content.querySelectorAll("[data-cdu-webtoon-source='true']").forEach((source) => {
      source.removeAttribute("data-cdu-webtoon-source");
      source.removeAttribute("aria-hidden");
    });

    let pane = content.querySelector(":scope > .cdu-webtoon-pane");
    let jump = content.querySelector(".cdu-webtoon-jump");
    if (!images.length) {
      pane?.remove();
      jump?.remove();
      return false;
    }

    const targets = images.map((image) => webtoonSourceTarget(image, content));
    targets.forEach((target) => {
      target.dataset.cduWebtoonSource = "true";
      target.setAttribute("aria-hidden", "true");
    });

    if (!jump) {
      jump = document.createElement("button");
      jump.type = "button";
      jump.className = "cdu-webtoon-jump";
      jump.innerHTML = `<span>프롤로그 웹툰 보기</span><span aria-hidden="true">→</span>`;
      jump.addEventListener("click", () => {
        setActiveDetailTab(content, "webtoon", { focus: true });
        body.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    if (jump.parentElement !== targets[0].parentElement || jump.nextElementSibling !== targets[0]) {
      targets[0].before(jump);
    }

    if (!pane) {
      pane = document.createElement("section");
      pane.className = "cdu-webtoon-pane";
      pane.dataset.cduDetailPane = "webtoon";
      content.append(pane);
    }

    const sources = images.map((image) => image.currentSrc || image.src).filter(Boolean);
    const signature = sources.join("|");
    if (pane.dataset.cduWebtoonSignature !== signature) {
      const heading = document.createElement("h2");
      heading.className = "cdu-webtoon-title";
      heading.textContent = "프롤로그 웹툰";
      const canvas = document.createElement("div");
      canvas.className = "cdu-webtoon-canvas";

      images.forEach((image, index) => {
        const clone = image.cloneNode(false);
        clone.className = "cdu-webtoon-image";
        clone.removeAttribute("id");
        clone.removeAttribute("style");
        clone.removeAttribute("aria-hidden");
        clone.removeAttribute("data-cdu-webtoon-source");
        clone.removeAttribute("srcset");
        clone.removeAttribute("sizes");
        clone.removeAttribute("width");
        clone.removeAttribute("height");
        clone.src = image.currentSrc || image.src;
        clone.alt = image.alt || `프롤로그 웹툰 이미지 ${index + 1}`;
        clone.loading = "lazy";
        clone.decoding = "async";
        canvas.append(clone);
      });

      pane.replaceChildren(heading, canvas);
      pane.dataset.cduWebtoonSignature = signature;
    }

    return true;
  }

  function markDetailTabs(body) {
    const content = body.children[1];
    if (!content) return;

    content.dataset.cduDetailContent = "true";
    const existingTablist = content.querySelector(":scope > .cdu-detail-tabs");
    const children = Array.from(content.children)
      .filter((element) => element !== existingTablist &&
        !element.classList.contains("cdu-detail-empty") &&
        !element.classList.contains("cdu-webtoon-pane"));

    children.forEach((child) => {
      child.dataset.cduDetailPane = detailPaneFor(child);
    });

    children.forEach((child, index) => {
      const pane = child.dataset.cduDetailPane;
      const previous = children[index - 1];
      if ((pane === "series" || pane === "ranking" || pane === "similar") && isDetailDivider(previous)) {
        previous.dataset.cduDetailPane = pane;
      }
    });

    const longImages = collectLongStoryImages(children);
    const hasWebtoon = syncWebtoonPane(content, body, longImages);
    const tabs = hasWebtoon
      ? [DETAIL_TABS[0], WEBTOON_TAB, ...DETAIL_TABS.slice(1)]
      : DETAIL_TABS;
    createDetailTabs(content, body, tabs);

    for (const [key, label] of DETAIL_TABS.slice(1)) {
      const hasContent = children.some((child) =>
        child.dataset.cduDetailPane === key && !isDetailDivider(child)
      );
      let empty = content.querySelector(`:scope > .cdu-detail-empty[data-cdu-detail-pane="${key}"]`);
      if (hasContent) {
        empty?.remove();
      } else if (!empty) {
        empty = document.createElement("div");
        empty.className = "cdu-detail-empty";
        empty.dataset.cduDetailPane = key;
        empty.textContent = `${label} 정보가 없어요`;
        content.append(empty);
      }
    }

    setActiveDetailTab(content, content.dataset.cduActiveDetailTab || "detail");
  }


  // Disconnect during synchronous decoration to avoid observing our own writes.
  // PageUI.watch reports health changes only, so it cannot detect every React redraw.
  let timer;
  const observer = new MutationObserver(scheduleScan);
  function scheduleScan() {
    if (timer !== undefined) return;
    timer = setTimeout(scan, 60);
  }
  function scan() {
    timer = undefined;
    observer.disconnect();
    try {
      for (const dialog of ui.resolve("overlay.dialogs").elements) {
        const body = dialog.querySelector(".character-info-modal-content-body");
        if (!body || body.children.length < 2) continue;
        const title = (dialog.getAttribute("aria-label") || "") + (dialog.textContent || "").slice(0, 100);
        const type = title.includes("스토리 정보") ? "story" : title.includes("캐릭터 정보") ? "character" : null;
        if (!type) continue;
        dialog.dataset.cduDialog = type;
        body.dataset.cduDialogBody = "true";
        if (type === "story") markDetailTabs(body);
      }
    } catch (error) {
      console.error("[크랙 상세 UI] 상세 화면 적용 실패", error);
    } finally {
      observer.observe(document.body, { subtree: true, childList: true, characterData: true,
        attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden", "aria-label", "src", "srcset", "height"] });
    }
  }
  window.addEventListener("popstate", scheduleScan);
  window.addEventListener("resize", scheduleScan);
  scan();
})();
