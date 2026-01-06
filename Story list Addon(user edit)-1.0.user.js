// ==UserScript==
// @name         Story list Addon (user edit)
// @namespace    https://github.com/workforomg/Utill
// @version      1.0
// @description  유저 편집 폴더
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    const STORAGE_KEY = 'my_custom_chat_folders_v1';

    // =================================================================
    // 1. 데이터 관리
    // =================================================================
    function getFolders() {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    }

    function saveFolders(folders) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
        renderFolders();
    }

    // =================================================================
    // 2. UI: 폴더 생성 버튼 (문맥 기반 정밀 타겟팅)
    // =================================================================
    function injectCreateButton() {
        // 이미 버튼이 있으면 종료
        if (document.getElementById('my-create-folder-btn')) return;

        // -------------------------------------------------------------
        // [핵심] "채팅 내역"이라는 글자를 먼저 찾습니다. (Anchor)
        // -------------------------------------------------------------
        const allParagraphs = document.querySelectorAll('p, span, div');
        let headerTextEl = null;

        for (let el of allParagraphs) {
            // 정확히 '채팅 내역'인 요소를 찾음 (공백 제거 후 비교)
            if (el.innerText.trim() === '채팅 내역') {
                headerTextEl = el;
                break;
            }
        }

        // '채팅 내역' 글자가 아직 안 떴으면 종료
        if (!headerTextEl) return;

        // -------------------------------------------------------------
        // [핵심] 그 글자의 부모(컨테이너)로 올라가서, 그 안의 '편집' 버튼을 찾습니다.
        // -------------------------------------------------------------
        // 보통 부모 div가 전체 헤더를 감싸고 있습니다.
        const headerContainer = headerTextEl.closest('div');
        if (!headerContainer) return;

        // 헤더 컨테이너 안에서 '편집' 글자를 가진 버튼 찾기
        const buttons = headerContainer.querySelectorAll('button');
        let targetBtn = null;

        for (let btn of buttons) {
            // 1. 텍스트가 '편집'이고
            // 2. 내가 만든 버튼(folder-edit-btn)이 아니어야 함 (중요!)
            if (btn.innerText.trim() === '편집' && !btn.classList.contains('folder-edit-btn')) {
                targetBtn = btn;
                break;
            }
        }

        if (!targetBtn) return;

        // 버튼 넣을 부모 찾기
        const btnParent = targetBtn.parentElement;
        if (!btnParent) return;

        // -------------------------------------------------------------
        // 버튼 생성
        // -------------------------------------------------------------
        const newBtn = targetBtn.cloneNode(true);
        newBtn.id = 'my-create-folder-btn';

        const newSpan = newBtn.querySelector('span');
        if (newSpan) newSpan.innerText = '폴더 생성';
        else newBtn.innerText = '폴더 생성';

        newBtn.style.marginRight = '8px';
        newBtn.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            createNewFolder();
        };

        btnParent.insertBefore(newBtn, targetBtn);
    }

    // =================================================================
    // 3. 핵심: 폴더 렌더링
    // =================================================================
    function renderFolders() {
        // 리스트 컨테이너 찾기 (CSS 클래스 의존도 최소화)
        // 보통 '채팅 내역' 아래에 있는 긴 리스트입니다.
        // 여기서는 기존 클래스(.css-ks2xqc)가 아직 유효하다고 가정하지만,
        // 만약 이것도 바뀌면 '채팅 내역' 부모의 형제 요소를 찾는 방식으로 바꿔야 합니다.
        const container = document.querySelector('.css-ks2xqc');
        if (!container) return;

        const folders = getFolders();

        folders.forEach(folderData => {
            let folderEl = document.getElementById(`folder-${folderData.id}`);

            if (!folderEl) {
                folderEl = createFolderElement(folderData);
                container.prepend(folderEl);
            } else {
                folderEl.querySelector('.folder-name').innerText = folderData.name;
            }

            const contentBox = folderEl.querySelector('.folder-content');

            // 납치 로직
            folderData.items.forEach(href => {
                const foundItems = document.querySelectorAll(`a[href="${href}"]`);
                foundItems.forEach(item => {
                    if (!item.closest(`#folder-${folderData.id}`)) {
                        const oldItem = contentBox.querySelector(`a[href="${href}"]`);
                        if (oldItem) oldItem.remove();
                        contentBox.appendChild(item);
                    }
                });
            });

            // 카운트
            const countSpan = folderEl.querySelector('.folder-count');
            if (countSpan) {
                const realCount = contentBox.querySelectorAll('a').length;
                countSpan.innerText = `(${realCount})`;
            }
        });
    }

    function createFolderElement(folderData) {
        const wrapper = document.createElement('div');
        wrapper.className = 'my-folder-wrapper';
        wrapper.id = `folder-${folderData.id}`;

        const header = document.createElement('div');
        header.className = 'folder-header';

        const titleArea = document.createElement('div');
        titleArea.className = 'folder-title-area';
        titleArea.innerHTML = `
            <span class="folder-icon">📂</span>
            <span class="folder-name">${folderData.name}</span>
            <span class="folder-count">(${folderData.items.length})</span>
        `;

        const editBtn = document.createElement('button');
        editBtn.className = 'folder-edit-btn'; // 이 클래스를 통해 메인 편집 버튼과 구분합니다.
        editBtn.innerText = '설정'; // 헷갈리지 않게 '설정'으로 명명 (원하면 '편집'으로 바꿔도 위 로직 덕에 안전함)

        const content = document.createElement('div');
        content.className = 'folder-content';

        titleArea.addEventListener('click', () => {
            wrapper.classList.toggle('open');
            if (content.style.maxHeight) {
                content.style.maxHeight = null;
            } else {
                content.style.maxHeight = "none";
            }
        });

        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openSettingsModal(folderData.id);
        });

        header.appendChild(titleArea);
        header.appendChild(editBtn);
        wrapper.appendChild(header);
        wrapper.appendChild(content);

        return wrapper;
    }

    function createNewFolder() {
        const folders = getFolders();
        const newId = Date.now().toString();
        const newFolder = {
            id: newId,
            name: '새 폴더',
            items: []
        };
        folders.push(newFolder);
        saveFolders(folders);
        setTimeout(() => openSettingsModal(newId), 100);
    }

    // =================================================================
    // 4. 설정 모달창
    // =================================================================
    function openSettingsModal(folderId) {
        const oldModal = document.getElementById('my-folder-modal');
        if (oldModal) oldModal.remove();

        const folders = getFolders();
        const currentFolder = folders.find(f => f.id === folderId);
        if (!currentFolder) return;

        const occupiedHrefs = new Set();
        folders.forEach(f => {
            if (f.id !== folderId) {
                f.items.forEach(href => occupiedHrefs.add(href));
            }
        });

        const allChatItems = [];
        document.querySelectorAll('a[href*="/stories/"]').forEach(el => {
            let rawText = el.innerText;
            let cleanName = rawText.split('\n')[0].trim();
            if (cleanName.includes('>')) cleanName = cleanName.split('>')[0].trim();
            if (cleanName.length > 30) cleanName = cleanName.substring(0, 30) + '...';
            if (!cleanName) cleanName = "이름 없는 스토리";

            allChatItems.push({
                href: el.getAttribute('href'),
                text: cleanName
            });
        });

        const addedItems = currentFolder.items;
        let tempAddedHrefs = [...addedItems];

        const modal = document.createElement('div');
        modal.id = 'my-folder-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3>📂 폴더 설정</h3>
                <div class="input-group">
                    <label>폴더 이름</label>
                    <input type="text" id="folder-name-input" value="${currentFolder.name}">
                </div>
                <div class="dual-list-container">
                    <div class="list-box">
                        <div class="list-title">추가 가능한 항목</div>
                        <div class="list-items" id="source-list"></div>
                    </div>
                    <div class="arrow-area">➡<br>⬅</div>
                    <div class="list-box">
                        <div class="list-title">현재 폴더에 포함됨</div>
                        <div class="list-items" id="target-list"></div>
                    </div>
                </div>
                <div class="info-msg">* 다른 폴더에 있는 항목은 표시되지 않습니다.</div>
                <div class="modal-footer">
                    <button id="btn-delete-folder" class="danger">폴더 삭제</button>
                    <div style="flex:1"></div>
                    <button id="btn-cancel">취소</button>
                    <button id="btn-save" class="primary">저장</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        const sourceListEl = modal.querySelector('#source-list');
        const targetListEl = modal.querySelector('#target-list');

        function renderLists() {
            sourceListEl.innerHTML = '';
            targetListEl.innerHTML = '';
            const uniqueItems = new Map();
            allChatItems.forEach(item => uniqueItems.set(item.href, item));

            uniqueItems.forEach((item, href) => {
                if (occupiedHrefs.has(href)) return;
                const div = document.createElement('div');
                div.className = 'list-item';
                div.innerText = item.text;

                if (tempAddedHrefs.includes(href)) {
                    const targetDiv = div.cloneNode(true);
                    targetDiv.onclick = () => {
                        tempAddedHrefs = tempAddedHrefs.filter(h => h !== href);
                        renderLists();
                    };
                    targetListEl.appendChild(targetDiv);
                } else {
                    div.onclick = () => {
                        tempAddedHrefs.push(href);
                        renderLists();
                    };
                    sourceListEl.appendChild(div);
                }
            });
        }
        renderLists();

        modal.querySelector('#btn-save').onclick = () => {
            currentFolder.name = modal.querySelector('#folder-name-input').value;
            currentFolder.items = tempAddedHrefs;
            const idx = folders.findIndex(f => f.id === folderId);
            folders[idx] = currentFolder;
            saveFolders(folders);
            modal.remove();
        };

        modal.querySelector('#btn-cancel').onclick = () => modal.remove();

        modal.querySelector('#btn-delete-folder').onclick = () => {
            if(confirm('폴더를 삭제하시겠습니까? (내용물은 유지됩니다)')) {
                const newFolders = folders.filter(f => f.id !== folderId);
                saveFolders(newFolders);
                const folderEl = document.getElementById(`folder-${folderId}`);
                if (folderEl) {
                    const content = folderEl.querySelector('.folder-content');
                    while(content.firstChild) folderEl.parentNode.insertBefore(content.firstChild, folderEl);
                    folderEl.remove();
                }
                modal.remove();
            }
        };
    }

    // =================================================================
    // 5. 실행 및 스타일
    // =================================================================
    setInterval(() => {
        injectCreateButton();
        renderFolders();
    }, 800);

    GM_addStyle(`
        .my-folder-wrapper {
            margin-bottom: 8px;
            background-color: rgba(125, 125, 125, 0.08);
            border: 1px solid rgba(125, 125, 125, 0.2);
            border-radius: 8px;
            overflow: hidden;
            color: inherit;
        }
        .folder-header {
            display: flex; align-items: center; justify-content: space-between;
            padding: 10px 14px; cursor: pointer; background-color: rgba(125, 125, 125, 0.1);
        }
        .folder-title-area { flex: 1; font-weight: bold; display: flex; align-items: center; }
        .folder-count { margin-left: 6px; font-size: 0.9em; opacity: 0.7; font-weight: normal; }
        .folder-edit-btn {
            background: rgba(125,125,125,0.2); border: none; border-radius: 4px;
            padding: 4px 8px; font-size: 12px; cursor: pointer; color: inherit;
        }
        .folder-edit-btn:hover { background: rgba(125,125,125,0.4); }
        .folder-content { max-height: 0; overflow: hidden; background-color: rgba(0,0,0,0.02); }
        .my-folder-wrapper.open .folder-content { border-top: 1px solid rgba(125,125,125,0.1); }
        #my-folder-modal {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5); display: flex; justify-content: center; align-items: center;
            z-index: 9999; color: #333;
        }
        #my-folder-modal .modal-content {
            background: #fff; padding: 20px; border-radius: 12px; width: 500px; max-width: 90%;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5); display: flex; flex-direction: column; gap: 15px;
        }
        #my-folder-modal h3 { margin: 0; font-size: 18px; }
        .input-group label { display: block; font-size: 12px; color: #666; margin-bottom: 5px; }
        .input-group input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }
        .dual-list-container { display: flex; height: 300px; gap: 10px; }
        .list-box { flex: 1; border: 1px solid #ddd; border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
        .list-title { background: #f1f1f1; padding: 8px; font-size: 12px; font-weight: bold; text-align: center; border-bottom: 1px solid #ddd; }
        .list-items { flex: 1; overflow-y: auto; padding: 5px; }
        .list-item { padding: 8px; font-size: 13px; border-bottom: 1px solid #eee; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .list-item:hover { background: #eef; }
        .arrow-area { display: flex; align-items: center; justify-content: center; font-size: 20px; color: #999; flex-direction: column; }
        .modal-footer { display: flex; gap: 10px; justify-content: flex-end; }
        .modal-footer button { padding: 8px 16px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; }
        .modal-footer button.primary { background: #007aff; color: white; border-color: #007aff; }
        .modal-footer button.danger { background: #ff3b30; color: white; border-color: #ff3b30; }
        .info-msg { font-size: 11px; color: #888; text-align: right; margin-top: -10px; }
        @media (prefers-color-scheme: dark) {
            #my-folder-modal .modal-content { background: #2c2c2c; color: #eee; }
            .input-group input { background: #3a3a3a; border-color: #555; color: #fff; }
            .list-box { border-color: #555; }
            .list-title { background: #3a3a3a; border-color: #555; }
            .list-item { border-bottom-color: #444; }
            .list-item:hover { background: #444; }
            .modal-footer button { background: #3a3a3a; color: #eee; border-color: #555; }
        }
    `);
})();
