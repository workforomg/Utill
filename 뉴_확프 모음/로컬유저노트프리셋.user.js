// ==UserScript==
// @name         로컬 유저노트 프리셋
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @updateURL    https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EB%A1%9C%EC%BB%AC%EC%9C%A0%EC%A0%80%EB%85%B8%ED%8A%B8%ED%94%84%EB%A6%AC%EC%85%8B.user.js
// @downloadURL  https://github.com/workforomg/Utill/raw/refs/heads/main/%EB%89%B4_%ED%99%95%ED%94%84%20%EB%AA%A8%EC%9D%8C/%EB%A1%9C%EC%BB%AC%EC%9C%A0%EC%A0%80%EB%85%B8%ED%8A%B8%ED%94%84%EB%A6%AC%EC%85%8B.user.js
// @author       지유지요
// @description  로컬 유저노트 프리셋을 추가합니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-idle
// @grant        none
// @require      https://cdn.jsdelivr.net/gh/workforomg/Utill@main/dist/ui.js
// ==/UserScript==

(async () => {
  const { watchDOM, setPrompt } = globalThis.CrackUI ?? {};
  if (typeof watchDOM !== 'function' || typeof setPrompt !== 'function') {
    throw new Error('Utill dist/ui.js의 CrackUI를 불러오지 못했습니다.');
  }

const MARK = 'data-local-note-presets';
const NAMESPACE = 'crack-local-usernote-presets-v1';
const SCOPE = 'all';

// Read the site's extension switch, excluding this panel and other add-ons.
function readNoteExtension(dialog) {
  const switches = [...dialog.querySelectorAll('[role="switch"],input[type="checkbox"]')]
    .filter(el => !el.closest(`[${MARK}],[hidden],[aria-hidden="true"]`) && !el.id.startsWith('script-'));
  const labelled = switches.filter(el => {
    const doc = el.ownerDocument;
    const label = [el.getAttribute('aria-label'),
      ...(el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => doc.getElementById(id)?.textContent),
      ...[...(el.labels || [])].map(label => label.textContent),
      el.parentElement?.textContent].filter(Boolean).join(' ');
    return /확장|2[,.]?000\s*자/.test(label);
  });
  const candidates = labelled.length ? labelled : switches;
  if (candidates.length !== 1) return null;
  const el = candidates[0], aria = el.getAttribute('aria-checked'), state = el.getAttribute('data-state');
  if (aria === 'true' || aria === 'false') return aria === 'true';
  if (state === 'checked' || state === 'unchecked') return state === 'checked';
  if (el.matches('input[type="checkbox"]')) return el.indeterminate ? null : el.checked;
  return null;
}

function extensionLabel(isExtend) {
  return isExtend === true ? '2,000자 확장' : isExtend === false ? '기본 500자' : '확장 여부 미확인';
}

function noteLimit(dialog, editor) {
  const extended = readNoteExtension(dialog);
  const modeLimit = extended === true ? 2000 : extended === false ? 500 : null;
  const inputLimit = editor.maxLength >= 0 ? editor.maxLength : null;
  if (modeLimit === null) return inputLimit;
  return inputLimit === null ? modeLimit : Math.min(modeLimit, inputLimit);
}

/** Resolve only the site's user-note dialog; never select our preset editor. */
function findUserNoteEditor(doc) {
  for (const dialog of doc.querySelectorAll('[role="dialog"],dialog[open]')) {
    if (dialog.closest('[hidden],[aria-hidden="true"]') || dialog.getAttribute('data-state') === 'closed') continue;
    const labelled = (dialog.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => doc.getElementById(id)?.textContent || '').join(' ');
    const titles = [...dialog.querySelectorAll('h1,h2,h3,[role="heading"],p,span')].filter(el => !el.closest(`[${MARK}]`) && (el.matches('h1,h2,h3,[role="heading"]') || /^유저\s*노트$/.test(el.textContent.trim()))).map(el => el.textContent);
    if (![dialog.getAttribute('aria-label'), labelled, ...titles].some(s => /유저\s*노트/.test(s || ''))) continue;
    const editors = [...dialog.querySelectorAll('textarea')].filter(el => !el.closest(`[${MARK}]`) && !el.hidden && el.getAttribute('aria-hidden') !== 'true');
    if (editors.length === 1 && !editors[0].disabled) return { dialog, editor: editors[0] };
  }
  return null;
}

function mergeUserNote(current, preset, mode, maxLength = -1) {
  if (!['append', 'replace'].includes(mode)) throw new Error('알 수 없는 적용 방식입니다.');
  const next = mode === 'replace' ? preset : current + (current && preset && !current.endsWith('\n') ? '\n' : '') + preset;
  if (maxLength >= 0 && next.length > maxLength) throw new Error(`글자 수 제한(${maxLength}자)을 초과합니다. 내용을 줄이거나 사이트의 노트 확장 설정을 확인하세요.`);
  return next;
}

/** No server requests. Site persistence stays with the site's existing save action. */
function installUserNotePresets({ doc = document, storage = doc.defaultView.localStorage } = {}) {
  const win = doc.defaultView;
  // SDK 2 no longer contains local notebook storage. Preserve existing v1 keys.
  const notePrefix = scope => `${NAMESPACE}:note:${encodeURIComponent(scope)}:`;
  const noteKey = (scope, name) => notePrefix(scope) + encodeURIComponent(name);
  const notebook = {
    get: (scope, name) => JSON.parse(storage.getItem(noteKey(scope, name)) ?? 'null'),
    save(scope, name, content, isExtend) {
      storage.setItem(noteKey(scope, name), JSON.stringify({ contentId: scope, name, content, isExtend, updatedAt: new Date().toISOString() }));
    },
    remove: (scope, name) => storage.removeItem(noteKey(scope, name)),
    list(scope) {
      return Array.from({ length: storage.length }, (_, i) => storage.key(i))
        .filter(key => key?.startsWith(notePrefix(scope)))
        .map(key => JSON.parse(storage.getItem(key)));
    },
  };
  const style = doc.createElement('style');
  style.textContent = `
    [data-local-note-layout] {width:min(1000px,calc(100vw - 32px))!important;max-width:calc(100vw - 32px)!important;box-sizing:border-box!important;padding-right:344px!important;}
    [${MARK}] {position:absolute;right:16px;top:60px;bottom:24px;width:300px;display:flex;flex-direction:column;gap:10px;padding:16px;border:1px solid #8885;border-radius:12px;background:inherit;color:inherit;font:14px/1.5 system-ui,sans-serif;box-sizing:border-box;overflow:auto;}
    [${MARK}] * {box-sizing:border-box;}
    [${MARK}] h3,[${MARK}] p {margin:0;}
    [${MARK}] h3 {font-size:16px;font-weight:700;}
    [${MARK}] input,[${MARK}] textarea {display:block;width:100%;min-width:0;background:transparent;color:inherit;border:1px solid #8887;border-radius:6px;padding:8px;font:inherit;}
    [${MARK}] textarea {resize:vertical;min-height:96px;}
    [${MARK}] button {font:inherit;padding:7px 10px;border:1px solid #8886;border-radius:6px;background:transparent;color:inherit;cursor:pointer;white-space:normal;}
    [${MARK}] button:hover {background:#8882;}
    [${MARK}] button:disabled {opacity:.4;cursor:default;}
    [${MARK}] button[aria-pressed="true"] {background:#6757d522;border-color:#8d7fe7;}
    [${MARK}] .ln-list {display:flex;flex-direction:column;gap:5px;overflow:auto;min-height:65px;max-height:160px;flex-shrink:0;}
    [${MARK}] .ln-list button {text-align:left;overflow-wrap:anywhere;}
    [${MARK}] .ln-badge {display:block;width:fit-content;margin-top:4px;padding:1px 6px;border-radius:4px;background:#8882;font-size:11px;}
    [${MARK}] .ln-row {display:flex;gap:6px;flex-wrap:wrap;}
    [${MARK}] .ln-footer {margin-top:auto;padding-top:12px;border-top:1px solid #8884;display:flex;flex-direction:column;gap:8px;}
    [${MARK}] .ln-hint {font-size:12px;opacity:.75;}
    [${MARK}] .ln-capacity {font-size:12px;white-space:pre-line;}
    [${MARK}] .ln-capacity[data-insufficient="true"] {color:#b45309;background:#f59e0b18;border:1px solid #f59e0b66;border-radius:6px;padding:8px;}
    [${MARK}] [role="status"] {font-size:12px;overflow-wrap:anywhere;}
    [${MARK}] :focus-visible {outline:2px solid #8d7fe7;outline-offset:2px;}
    @media(max-width:760px) {
      [data-local-note-layout] {padding-right:24px!important;max-height:90dvh!important;overflow-y:auto!important;}
      [${MARK}] {position:static;width:100%;max-height:none;margin-top:16px;}
    }`;
  doc.head.append(style);
  let mounted = null;
  function mount(dialog, editor) {
    const panel = doc.createElement('aside');
    panel.setAttribute(MARK, ''); panel.setAttribute('aria-label', '로컬 유저노트 프리셋');
    dialog.setAttribute('data-local-note-layout', '');
    let selected = null, previous = null;
    const node = (tag, text, className) => { const el = doc.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; };
    const status = node('p'); status.setAttribute('role', 'status');
    const extensionStatus = node('p', null, 'ln-hint');
    const capacity = node('p', null, 'ln-capacity');
    capacity.setAttribute('aria-live', 'polite');
    capacity.setAttribute('aria-label', '유저노트 남은 글자 수');
    function updateCapacity() {
      const limit = noteLimit(dialog, editor);
      let message, insufficient = false;
      if (limit === null) {
        message = '글자 수 제한을 확인할 수 없습니다. 유저노트 확장 설정을 확인하세요.';
      } else {
        const remaining = Math.max(0, limit - editor.value.length);
        const next = mergeUserNote(editor.value, content.value, 'append');
        const required = next.length - editor.value.length;
        insufficient = Boolean(content.value) && next.length > limit;
        message = insufficient
          ? `남은 글자 수가 부족합니다. ${remaining}자 남음 · 붙여넣기 ${required}자 필요 (줄바꿈 포함)\n${next.length - limit}자를 줄여야 붙여넣을 수 있습니다.`
          : `${remaining}자 남음 / ${limit}자 · 붙여넣기 ${required}자 (줄바꿈 포함)`;
        if (content.value.length > limit) message += `\n전체 덮어쓰기도 ${content.value.length - limit}자 초과합니다.`;
      }
      if (capacity.textContent !== message) capacity.textContent = message;
      const flag = String(insufficient);
      if (capacity.getAttribute('data-insufficient') !== flag) capacity.setAttribute('data-insufficient', flag);
    }
    extensionStatus.setAttribute('aria-live', 'polite');
    const updateExtension = () => {
      const label = `저장 시 기록할 설정: ${extensionLabel(readNoteExtension(dialog))}`;
      if (extensionStatus.textContent !== label) extensionStatus.textContent = label;
      updateCapacity();
    };
    const input = (tag, label) => { const el = node(tag); el.setAttribute('aria-label', label); el.placeholder = label; return el; };
    const search = input('input', '프리셋 검색'); search.type = 'search';
    const list = node('div', null, 'ln-list'); list.setAttribute('aria-label', '저장된 프리셋 목록');
    const name = input('input', '프리셋 이름'); name.maxLength = 100;
    const content = input('textarea', '프리셋 내용'); content.rows = 5;
    const button = (label, handler) => { const el = node('button', label); el.type = 'button'; el.addEventListener('click', () => { try { handler(); } catch (error) { status.textContent = error.message; } }); return el; };
    const dirty = () => { const note = selected && notebook.get(SCOPE, selected); return note ? name.value !== note.name || content.value !== note.content : Boolean(name.value || content.value); };
    const leave = () => !dirty() || win.confirm('저장하지 않은 프리셋 편집 내용을 버릴까요?');
    const notes = () => notebook.list(SCOPE).filter(n => n && typeof n.name === 'string' && typeof n.content === 'string').sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    function refresh() {
      const items = notes().filter(n => `${n.name}\n${n.content}`.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
      list.replaceChildren();
      for (const note of items) {
        const el = button(note.name, () => { if (!leave()) return; selected = note.name; name.value = note.name; content.value = note.content; status.textContent = ''; refresh(); });
        el.setAttribute('aria-label', note.name);
        const badge = node('span', extensionLabel(note.isExtend), 'ln-badge');
        badge.title = '프리셋 저장 당시 유저노트 확장 설정';
        el.append(badge);
        el.setAttribute('aria-pressed', String(selected === note.name)); list.append(el);
      }
      if (!items.length) list.append(node('p', search.value ? '검색 결과가 없습니다.' : '저장된 프리셋이 없습니다. 아래에서 만들어 보세요.', 'ln-hint'));
      remove.disabled = !selected;
      updateCapacity();
    }
    const fresh = button('새 프리셋', () => { if (!leave()) return; selected = null; name.value = ''; content.value = ''; refresh(); name.focus(); });
    const capture = button('현재 노트 가져오기', () => { if (!leave()) return; selected = null; name.value = ''; content.value = editor.value; refresh(); name.focus(); });
    const save = button('로컬 저장', () => {
      const title = name.value.trim();
      if (!title) throw new Error('프리셋 이름을 입력하세요.');
      if (!content.value.trim()) throw new Error('프리셋 내용을 입력하세요.');
      if (title !== selected && notebook.get(SCOPE, title) && !win.confirm('같은 이름의 프리셋이 있습니다. 교체할까요?')) return;
      notebook.save(SCOPE, title, content.value, readNoteExtension(dialog));
      if (selected && selected !== title) notebook.remove(SCOPE, selected);
      selected = title; name.value = title; search.value = ''; refresh(); status.textContent = '이 브라우저에 저장했습니다.';
    });
    const remove = button('삭제', () => { if (!selected || !win.confirm(`“${selected}” 프리셋을 삭제할까요?`)) return; notebook.remove(SCOPE, selected); selected = null; name.value = ''; content.value = ''; refresh(); status.textContent = '프리셋을 삭제했습니다.'; });
    function apply(mode) {
      if (!editor.isConnected || editor.readOnly || editor.disabled) throw new Error('유저노트 편집창을 다시 열어주세요.');
      if (!content.value.trim()) throw new Error('적용할 프리셋 내용을 입력하거나 목록에서 선택하세요.');
      updateCapacity();
      const next = mergeUserNote(editor.value, content.value, mode, noteLimit(dialog, editor) ?? -1);
      if (mode === 'replace' && editor.value && !win.confirm('현재 유저노트 전체를 이 프리셋으로 덮어쓸까요?')) return;
      const before = editor.value;
      setPrompt(next, editor);
      previous = { before, after: next }; undo.disabled = false;
      status.textContent = '본문에 반영했습니다. 유저노트의 수정/저장 버튼으로 저장하세요.';
    }
    const append = button('붙여넣기', () => apply('append'));
    const replace = button('전체 덮어쓰기', () => apply('replace'));
    const undo = button('적용 되돌리기', () => {
      if (!previous) return;
      if (editor.readOnly || editor.disabled || !editor.isConnected) throw new Error('유저노트 편집창을 다시 열어주세요.');
      if (editor.value !== previous.after && !win.confirm('적용 후 직접 편집한 내용도 되돌릴까요?')) return;
      setPrompt(previous.before, editor); previous = null; undo.disabled = true; status.textContent = '적용 전 내용으로 되돌렸습니다.';
    }); undo.disabled = true;
    const row = (...els) => { const el = node('div', null, 'ln-row'); el.append(...els); return el; };
    const footer = node('div', null, 'ln-footer');
    footer.append(node('p', '붙여넣기는 기존 내용 끝에 추가합니다.', 'ln-hint'), capacity, row(append, replace), undo, node('p', '적용 후 기존 수정/저장 버튼을 눌러주세요.', 'ln-hint'), status);
    panel.append(node('h3', '유저노트 프리셋'), node('p', '이 브라우저에 저장 · 모든 작품에서 사용', 'ln-hint'), search, list, row(fresh, capture), name, content, extensionStatus, row(save, remove), footer);
    updateExtension();
    dialog.addEventListener('change', updateExtension);
    dialog.addEventListener('input', updateCapacity);
    search.addEventListener('input', () => { try { refresh(); } catch (error) { status.textContent = error.message; } });
    const sync = event => { if (event.storageArea === storage && (event.key === null || event.key.startsWith(`${NAMESPACE}:`))) { try { refresh(); status.textContent = '다른 탭에서 목록이 변경되었습니다. 편집 중인 내용은 유지했습니다.'; } catch (error) { status.textContent = error.message; } } };
    win.addEventListener('storage', sync);
    dialog.append(panel);
    try { refresh(); } catch { status.textContent = '로컬 저장소를 읽을 수 없습니다. 브라우저 저장소 설정을 확인하세요.'; }
    return { dialog, editor, panel, updateExtension, dispose() { dialog.removeEventListener('input', updateCapacity); dialog.removeEventListener('change', updateExtension); win.removeEventListener('storage', sync); panel.remove(); dialog.removeAttribute('data-local-note-layout'); } };
  }
  const stop = watchDOM(() => {
    const target = findUserNoteEditor(doc);
    if (mounted && (mounted.dialog !== target?.dialog || mounted.editor !== target?.editor || !mounted.panel.isConnected)) { mounted.dispose(); mounted = null; }
    if (target && !mounted) mounted = mount(target.dialog, target.editor);
    mounted?.updateExtension();
  }, { root: doc });
  return () => { stop(); mounted?.dispose(); style.remove(); };
}

  globalThis.__crackLocalUserNotePresetsDispose?.();
  globalThis.__crackLocalUserNotePresetsDispose = installUserNotePresets();
})().catch(error => {
  console.error('[유저노트 프리셋]', error);
  alert('유저노트 프리셋을 불러오지 못했습니다. 개발자 콘솔에서 오류를 확인하세요.');
});
