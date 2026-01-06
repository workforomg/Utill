// ==UserScript==
// @name         Crack Story list Addon(user edit)
// @namespace    https://github.com/omgworks/Crack_util
// @version      1.0
// @description  폴더생성, 유저 에딧
// @author       으악갹
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // =================================================================
    // [설정] 선택자 정의
    // =================================================================
    const selectors = {
        headerContainer: '.css-8v90jo', // '편집' 버튼 부모
        editButton: '.css-1hmzd2l', // 기존 '편집' 버튼
        listContainer: '.css-ks2xqc', // 리스트 전체 컨테이너
        chatItem: 'a[href*="/stories/"]', // 개별 채팅 아이템
    };

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
    // 2. UI: 폴더 생성 버튼
    // =================================================================
    function injectCreateButton() {
        const btnContainer = document.querySelector(selectors.headerContainer);
        if (!btnContainer || document.getElementById('my-create-folder-btn')) return;

        const existingBtn = btnContainer.querySelector(selectors.editButton);
        if (!existingBtn) return;

        const newBtn = existingBtn.cloneNode(true);
        newBtn.id = 'my-create-folder-btn';

        const span = newBtn.querySelector('span');
        if (span) span.innerText = '폴더 생성';
        else newBtn.innerText = '폴더 생성';

        newBtn.style.marginRight = '8px';
        newBtn.onclick = () => createNewFolder();
        btnContainer.insertBefore(newBtn, existingBtn);
    }

    // =================================================================
    // 3. 핵심: 폴더 렌더링 (중복 방지 로직 강화)
    // =================================================================
    function renderFolders() {
        const container = document.querySelector(selectors.listContainer);
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

            // 개수 업데이트
            const contentBox = folderEl.querySelector('.folder-content');
            // 실제 들어있는 갯수로 카운트 (화면 기준)
            const realCount = contentBox.querySelectorAll('a').length;
            const countSpan = folderEl.querySelector('.folder-count');
            if (countSpan) {
                // 데이터상 개수 vs 실제 개수 중 큰 것 표시 (보통 데이터 기준)
                countSpan.innerText = `(${folderData.items.length})`;
            }

            // --- [핵심 수정] "납치" 로직 ---
            folderData.items.forEach(href => {
                // 1. 문서 전체에서 해당 href를 가진 모든 요소를 찾음
                const foundItems = document.querySelectorAll(`a[href="${href}"]`);

                foundItems.forEach(item => {
                    // 2. 이 아이템이 '내 폴더' 안에 없는 녀석이라면? (즉, 리스트에 새로 생긴 놈)
                    if (!item.closest(`#folder-${folderData.id}`)) {

                        // 3. 폴더 안에 예전 버전의 아이템이 이미 들어있다면?
                        // (React가 새로 만든 놈이 더 싱싱하므로, 옛날 건 버리고 새 걸 넣어야 이벤트가 잘 먹힘)
                        const oldItem = contentBox.querySelector(`a[href="${href}"]`);
                        if (oldItem) {
                            oldItem.remove();
                        }

                        // 4. 새 아이템을 폴더로 이동
                        contentBox.appendChild(item);
                    }
                });
            });
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
        editBtn.className = 'folder-edit-btn';
        editBtn.innerText = '설정';

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

        // 다른 폴더 사용 중 체크
        const occupiedHrefs = new Set();
        folders.forEach(f => {
            if (f.id !== folderId) {
                f.items.forEach(href => occupiedHrefs.add(href));
            }
        });

        // 전체 아이템 스캔
        const allChatItems = [];
        document.querySelectorAll(selectors.chatItem).forEach(el => {
            let rawText = el.innerText;
            let cleanName = rawText.split('\n')[0].trim();
            if (cleanName.includes('>')) {
                cleanName = cleanName.split('>')[0].trim();
            }
            if (cleanName.length > 30) cleanName = cleanName.substring(0, 30) + '...';
            if (!cleanName) cleanName = "이름 없는 스토리";

            allChatItems.push({
                href: el.getAttribute('href'),
                text: cleanName
            });
        });

        const addedItems = currentFolder.items;
        let tempAddedHrefs = [...addedItems];

        // 모달 UI
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
                    <div class="arrow-area">
                        ➡<br>⬅
                    </div>
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
                    while(content.firstChild) {
                        folderEl.parentNode.insertBefore(content.firstChild, folderEl);
                    }
                    folderEl.remove();
                }
                modal.remove();
            }
        };
    }

    // =================================================================
    // 5. 실행 및 스타일
    // =================================================================

    // 반응 속도를 조금 높여서(800ms) 납치를 더 빠르게 수행
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
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            cursor: pointer;
            background-color: rgba(125, 125, 125, 0.1);
        }
        .folder-title-area {
            flex: 1;
            font-weight: bold;
            display: flex;
            align-items: center;
        }
        .folder-count {
            margin-left: 6px;
            font-size: 0.9em;
            opacity: 0.7;
            font-weight: normal;
        }
        .folder-edit-btn {
            background: rgba(125,125,125,0.2);
            border: none;
            border-radius: 4px;
            padding: 4px 8px;
            font-size: 12px;
            cursor: pointer;
            color: inherit;
        }
        .folder-edit-btn:hover { background: rgba(125,125,125,0.4); }

        .folder-content {
            max-height: 0;
            overflow: hidden;
            background-color: rgba(0,0,0,0.02);
        }
        .my-folder-wrapper.open .folder-content {
            border-top: 1px solid rgba(125,125,125,0.1);
        }

        #my-folder-modal {
            position: fixed;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0,0,0,0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
            color: #333;
        }
        #my-folder-modal .modal-content {
            background: #fff;
            padding: 20px;
            border-radius: 12px;
            width: 500px;
            max-width: 90%;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        #my-folder-modal h3 { margin: 0; font-size: 18px; }

        .input-group label { display: block; font-size: 12px; color: #666; margin-bottom: 5px; }
        .input-group input { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box; }

        .dual-list-container { display: flex; height: 300px; gap: 10px; }
        .list-box { flex: 1; border: 1px solid #ddd; border-radius: 6px; display: flex; flex-direction: column; overflow: hidden; }
        .list-title { background: #f1f1f1; padding: 8px; font-size: 12px; font-weight: bold; text-align: center; border-bottom: 1px solid #ddd; }
        .list-items { flex: 1; overflow-y: auto; padding: 5px; }

        .list-item {
            padding: 8px; font-size: 13px; border-bottom: 1px solid #eee; cursor: pointer;
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
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