// ==UserScript==
// @name         저장소 클라우드 동기화
// @namespace    https://github.com/workforomg/Utill
// @version      1.0.0
// @author       지유지요
// @description  사이트 localStorage/sessionStorage/IndexedDB를 PC와 휴대폰 사이에서 암호화 동기화합니다.
// @match        https://crack.wrtn.ai/*
// @run-at       document-start
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @connect      *
// ==/UserScript==

(() => {
  "use strict";

  const FORMAT = "site-storage-sync";
  const FORMAT_VERSION = 1;
  const CHECK_INTERVAL_MS = 5_000;
  const REQUEST_TIMEOUT_MS = 25_000;
  const KEYS = {
    enabled: "sync.enabled",
    cloudUrl: "sync.cloudUrl",
    syncKey: "sync.key",
    deviceId: "sync.deviceId",
    revision: "sync.revision",
    lastHash: "sync.lastHash",
    lastStatus: "sync.lastStatus",
    conflictBackup: "sync.conflictBackup",
  };

  const runtime = {
    timer: null,
    running: false,
    stopped: false,
    applying: false,
    menuIds: [],
    credentialCache: null,
  };

  initialize();

  function initialize() {
    ensureDeviceId();
    rebuildMenu();
    if (getSetting(KEYS.enabled, false)) void startAutomaticSync();
  }

  function rebuildMenu() {
    for (const id of runtime.menuIds) {
      try {
        GM_unregisterMenuCommand(id);
      } catch {
        // 구버전 Tampermonkey에서는 제거 실패가 동작에 영향을 주지 않습니다.
      }
    }
    runtime.menuIds = [];

    const enabled = getSetting(KEYS.enabled, false);
    addMenu(`☁ 자동 동기화: ${enabled ? "켜짐" : "꺼짐"}`, toggleAutomaticSync);
    addMenu("⬆ 수동 내보내기", manualExport);
    addMenu("⬇ 수동 불러오기", manualImport);
    addMenu("🌐 클라우드 주소", configureCloudUrl);
    addMenu("🔑 동기화 키", configureSyncKey);
    addMenu("🔄 지금 동기화", () => syncCycle({ forceRemote: true, manual: true }));
    addMenu("ℹ 동기화 상태", showStatus);
    if (getSetting(KEYS.conflictBackup, "")) {
      addMenu("⚠ 충돌본 내보내기", exportConflictBackup);
    }
  }

  function addMenu(label, callback) {
    runtime.menuIds.push(GM_registerMenuCommand(label, callback));
  }

  async function toggleAutomaticSync() {
    const next = !getSetting(KEYS.enabled, false);
    if (next && !isConfigured(true)) return;
    setSetting(KEYS.enabled, next);
    rebuildMenu();
    if (next) {
      runtime.stopped = false;
      await startAutomaticSync();
      notify("자동 동기화를 켰습니다.");
    } else {
      stopAutomaticSync();
      setStatus("자동 동기화 꺼짐");
      notify("자동 동기화를 껐습니다.");
    }
  }

  async function configureCloudUrl() {
    const current = getSetting(KEYS.cloudUrl, "");
    const input = prompt(
      "Cloudflare Worker 주소를 입력하세요.\n예: https://crack-storage-sync.계정.workers.dev",
      current,
    );
    if (input === null) return;
    const normalized = normalizeCloudUrl(input);
    if (!/^https:\/\//i.test(normalized)) {
      alert("https:// 로 시작하는 주소가 필요합니다.");
      return;
    }
    try {
      const response = await httpRequest({ method: "GET", url: `${normalized}/health` });
      if (response.status !== 200) throw new Error(`HTTP ${response.status}`);
      const health = JSON.parse(response.responseText);
      if (!health?.ok) throw new Error("동기화 서버가 아닙니다.");
    } catch (error) {
      alert(`주소 연결에 실패했습니다.\n${error.message}`);
      return;
    }
    setSetting(KEYS.cloudUrl, normalized);
    resetSyncCursor();
    alert("클라우드 주소를 저장했습니다.");
    restartIfEnabled();
  }

  function configureSyncKey() {
    const input = prompt(
      "PC와 휴대폰에 똑같이 입력할 동기화 키를 정하세요.\n길고 추측하기 어려운 문장을 권장합니다.\n\n키는 클라우드로 전송되지 않습니다.",
      "",
    );
    if (input === null) return;
    if (input.length < 12) {
      alert("동기화 키는 12자 이상으로 입력하세요.");
      return;
    }
    setSetting(KEYS.syncKey, input);
    runtime.credentialCache = null;
    resetSyncCursor();
    alert("동기화 키를 저장했습니다. 휴대폰에도 같은 키를 입력하세요.");
    restartIfEnabled();
  }

  function restartIfEnabled() {
    if (!getSetting(KEYS.enabled, false)) return;
    stopAutomaticSync();
    runtime.stopped = false;
    void startAutomaticSync();
  }

  function resetSyncCursor() {
    setSetting(KEYS.revision, 0);
    setSetting(KEYS.lastHash, "");
    setStatus("새 연결 설정됨");
  }

  function isConfigured(showAlert = false) {
    const cloudUrl = getSetting(KEYS.cloudUrl, "");
    const syncKey = getSetting(KEYS.syncKey, "");
    if (cloudUrl && syncKey) return true;
    if (showAlert) {
      alert("먼저 Tampermonkey 메뉴에서 클라우드 주소와 동기화 키를 설정하세요.");
    }
    return false;
  }

  async function startAutomaticSync() {
    if (runtime.running || runtime.stopped || !isConfigured(false)) return;
    await syncCycle({ forceRemote: !getSetting(KEYS.lastHash, "") });
    scheduleNextCycle();
  }

  function stopAutomaticSync() {
    runtime.stopped = true;
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = null;
  }

  function scheduleNextCycle() {
    if (runtime.stopped || !getSetting(KEYS.enabled, false)) return;
    if (runtime.timer) clearTimeout(runtime.timer);
    runtime.timer = setTimeout(async () => {
      await syncCycle();
      scheduleNextCycle();
    }, CHECK_INTERVAL_MS);
  }

  async function syncCycle({ forceRemote = false, manual = false } = {}) {
    if (runtime.running || runtime.applying) return;
    if (!isConfigured(manual)) return;
    runtime.running = true;
    try {
      const lastRevision = Number(getSetting(KEYS.revision, 0));
      const lastHash = getSetting(KEYS.lastHash, "");
      const remote = await fetchRemote(forceRemote || !lastHash);
      const local = await captureSnapshot({ includeSessionStorage: false });
      const localHash = await hashSnapshot(local);

      if (remote.kind === "snapshot") {
        const remoteSnapshot = await decryptSnapshot(remote.payload);
        validateSnapshot(remoteSnapshot);
        const remoteHash = await hashSnapshot(remoteSnapshot);

        if (remote.revision > lastRevision) {
          if (lastHash && localHash !== lastHash && localHash !== remoteHash) {
            await saveConflictBackup(local);
            notify("양쪽 기기에서 동시에 바뀌어 현재 기기 데이터를 충돌본으로 보관했습니다.");
          }
          await applyRemoteSnapshot(remoteSnapshot, remote.revision, remoteHash);
          return;
        }

        if (localHash !== remoteHash) {
          const result = await uploadSnapshot(local, localHash, remote.revision);
          if (result === "conflict") await resolveConflict();
        } else {
          setSetting(KEYS.lastHash, remoteHash);
          setSetting(KEYS.revision, remote.revision);
          setStatus(`동기화 완료 · 서버 버전 ${remote.revision}`);
        }
      } else if (remote.kind === "not-modified") {
        if (!lastHash) {
          setSetting(KEYS.lastHash, localHash);
        } else if (localHash !== lastHash) {
          const result = await uploadSnapshot(local, localHash, lastRevision);
          if (result === "conflict") await resolveConflict();
        } else {
          setStatus(`최신 상태 · 서버 버전 ${lastRevision}`);
        }
      } else if (remote.kind === "empty") {
        const result = await uploadSnapshot(local, localHash, 0);
        if (result === "conflict") await resolveConflict();
      }

      if (manual) {
        alert(getSetting(KEYS.lastStatus, "동기화를 완료했습니다."));
      }
    } catch (error) {
      console.error("[Storage Sync]", error);
      setStatus(`오류 · ${error.message}`);
      if (manual) alert(`동기화 실패\n${error.message}`);
    } finally {
      runtime.running = false;
    }
  }

  async function fetchRemote(force = false) {
    const credentials = await getCredentials();
    const revision = Number(getSetting(KEYS.revision, 0));
    const headers = { Authorization: `Sync ${credentials.authToken}` };
    if (!force && revision > 0) headers["If-None-Match"] = `"${revision}"`;

    const response = await httpRequest({
      method: "GET",
      url: endpoint(credentials.roomId),
      headers,
    });
    if (response.status === 304) return { kind: "not-modified" };
    if (response.status === 404) return { kind: "empty" };
    if (response.status === 403) throw new Error("동기화 키가 서버의 기존 키와 다릅니다.");
    if (response.status !== 200) throw httpError(response);

    const body = JSON.parse(response.responseText);
    return {
      kind: "snapshot",
      revision: Number(body.revision),
      payload: body.payload,
      updatedAt: body.updatedAt,
      deviceId: body.deviceId,
    };
  }

  async function uploadSnapshot(snapshot, snapshotHash, baseRevision) {
    const credentials = await getCredentials();
    const encrypted = await encryptSnapshot(snapshot);
    const payload = JSON.stringify(encrypted);
    const response = await httpRequest({
      method: "PUT",
      url: endpoint(credentials.roomId),
      headers: {
        Authorization: `Sync ${credentials.authToken}`,
        "Content-Type": "application/json",
      },
      data: JSON.stringify({
        baseRevision,
        deviceId: ensureDeviceId(),
        payload,
      }),
    });

    if (response.status === 409) return "conflict";
    if (response.status === 413) {
      throw new Error("백업 데이터가 서버 제한(암호화 후 8MB)을 넘었습니다.");
    }
    if (response.status === 403) throw new Error("동기화 키가 서버의 기존 키와 다릅니다.");
    if (response.status !== 200) throw httpError(response);

    const body = JSON.parse(response.responseText);
    setSetting(KEYS.revision, Number(body.revision));
    setSetting(KEYS.lastHash, snapshotHash);
    setStatus(`업로드 완료 · 서버 버전 ${body.revision}`);
    return "uploaded";
  }

  async function resolveConflict() {
    const local = await captureSnapshot({ includeSessionStorage: false });
    await saveConflictBackup(local);
    const remote = await fetchRemote(true);
    if (remote.kind !== "snapshot") throw new Error("충돌 후 서버 데이터를 읽지 못했습니다.");
    const snapshot = await decryptSnapshot(remote.payload);
    validateSnapshot(snapshot);
    const hash = await hashSnapshot(snapshot);
    notify("다른 기기의 저장이 먼저 완료되어 서버 데이터를 적용합니다. 현재 값은 충돌본으로 보관했습니다.");
    await applyRemoteSnapshot(snapshot, remote.revision, hash);
  }

  async function applyRemoteSnapshot(snapshot, revision, hash) {
    runtime.applying = true;
    setStatus(`서버 버전 ${revision} 적용 중`);
    try {
      await restoreSnapshot(snapshot, { restoreSessionStorage: false });
      setSetting(KEYS.revision, revision);
      setSetting(KEYS.lastHash, hash);
      setStatus(`불러오기 완료 · 서버 버전 ${revision} · 자동 새로고침 안 함`);
    } finally {
      runtime.applying = false;
    }
  }

  async function manualExport() {
    try {
      const snapshot = await captureSnapshot({ includeSessionStorage: true });
      const syncKey = getSetting(KEYS.syncKey, "");
      let file;
      if (syncKey) {
        file = {
          format: `${FORMAT}-file`,
          version: FORMAT_VERSION,
          origin: location.origin,
          exportedAt: new Date().toISOString(),
          encrypted: true,
          payload: await encryptSnapshot(snapshot),
        };
      } else {
        const proceed = confirm(
          "동기화 키가 없어 암호화하지 않은 JSON으로 내보냅니다. 계속할까요?",
        );
        if (!proceed) return;
        file = {
          format: `${FORMAT}-file`,
          version: FORMAT_VERSION,
          origin: location.origin,
          exportedAt: new Date().toISOString(),
          encrypted: false,
          snapshot,
        };
      }
      downloadJson(file, `crack-storage-backup-${fileTimestamp()}.json`);
      setStatus("수동 내보내기 완료");
    } catch (error) {
      alert(`내보내기 실패\n${error.message}`);
    }
  }

  function manualImport() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.hidden = true;
    input.addEventListener(
      "change",
      async () => {
        try {
          const file = input.files?.[0];
          if (!file) return;
          const wrapper = JSON.parse(await file.text());
          if (wrapper.format !== `${FORMAT}-file`) throw new Error("지원하지 않는 백업 파일입니다.");
          if (wrapper.origin !== location.origin) {
            const proceed = confirm(
              `백업 출처(${wrapper.origin})가 현재 사이트(${location.origin})와 다릅니다. 계속할까요?`,
            );
            if (!proceed) return;
          }
          const snapshot = wrapper.encrypted
            ? await decryptSnapshot(wrapper.payload)
            : wrapper.snapshot;
          validateSnapshot(snapshot, false);
          await restoreSnapshot(snapshot, { restoreSessionStorage: true });
          setSetting(KEYS.lastHash, "");
          setStatus("수동 불러오기 완료 · 새로고침 중");
          alert("불러오기를 완료했습니다. 페이지를 새로고침합니다.");
          location.reload();
        } catch (error) {
          alert(`불러오기 실패\n${error.message}`);
        } finally {
          input.remove();
        }
      },
      { once: true },
    );
    (document.documentElement || document).appendChild(input);
    input.click();
  }

  async function saveConflictBackup(snapshot) {
    try {
      const wrapper = {
        format: `${FORMAT}-file`,
        version: FORMAT_VERSION,
        origin: location.origin,
        exportedAt: new Date().toISOString(),
        encrypted: true,
        payload: await encryptSnapshot(snapshot),
      };
      setSetting(KEYS.conflictBackup, JSON.stringify(wrapper));
      rebuildMenu();
    } catch (error) {
      console.warn("[Storage Sync] 충돌본 보관 실패", error);
    }
  }

  function exportConflictBackup() {
    const raw = getSetting(KEYS.conflictBackup, "");
    if (!raw) return;
    try {
      downloadJson(JSON.parse(raw), `crack-storage-conflict-${fileTimestamp()}.json`);
      if (confirm("충돌본을 내보냈습니다. Tampermonkey 내부 보관본을 지울까요?")) {
        deleteSetting(KEYS.conflictBackup);
        rebuildMenu();
      }
    } catch (error) {
      alert(`충돌본 내보내기 실패\n${error.message}`);
    }
  }

  function showStatus() {
    const status = getSetting(KEYS.lastStatus, "아직 동기화 기록이 없습니다.");
    const revision = getSetting(KEYS.revision, 0);
    const url = getSetting(KEYS.cloudUrl, "설정 안 됨");
    alert(
      `상태: ${status}\n서버 버전: ${revision}\n클라우드: ${url}\n확인 주기: ${CHECK_INTERVAL_MS / 1000}초`,
    );
  }

  async function captureSnapshot({ includeSessionStorage = false } = {}) {
    const warnings = [];
    return {
      format: FORMAT,
      version: FORMAT_VERSION,
      origin: location.origin,
      capturedAt: new Date().toISOString(),
      localStorage: dumpStorage(localStorage, warnings, "localStorage"),
      sessionStorage: includeSessionStorage
        ? dumpStorage(sessionStorage, warnings, "sessionStorage")
        : null,
      indexedDB: await dumpIndexedDatabases(warnings),
      warnings,
    };
  }

  function dumpStorage(storage, warnings, label) {
    const output = {};
    try {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key !== null) keys.push(key);
      }
      keys.sort();
      for (const key of keys) output[key] = storage.getItem(key);
    } catch (error) {
      warnings.push(`${label}: ${error.message}`);
    }
    return output;
  }

  async function dumpIndexedDatabases(warnings) {
    if (typeof indexedDB.databases !== "function") {
      warnings.push("이 브라우저는 IndexedDB 목록 열거를 지원하지 않습니다.");
      return [];
    }
    const infos = (await indexedDB.databases())
      .filter((info) => info.name)
      .sort((left, right) => left.name.localeCompare(right.name));
    const databases = [];
    for (const info of infos) {
      try {
        databases.push(await dumpOneDatabase(info.name));
      } catch (error) {
        warnings.push(`IndexedDB ${info.name}: ${error.message}`);
      }
    }
    return databases;
  }

  async function dumpOneDatabase(name) {
    const db = await openDatabase(name);
    try {
      const stores = [];
      const storeNames = Array.from(db.objectStoreNames).sort();
      for (const storeName of storeNames) {
        stores.push(await dumpOneStore(db, storeName));
      }
      return { name, version: db.version, stores };
    } finally {
      db.close();
    }
  }

  async function dumpOneStore(db, storeName) {
    const transaction = db.transaction(storeName, "readonly");
    const store = transaction.objectStore(storeName);
    const indexes = Array.from(store.indexNames)
      .sort()
      .map((name) => {
        const index = store.index(name);
        return {
          name: index.name,
          keyPath: cloneKeyPath(index.keyPath),
          unique: index.unique,
          multiEntry: index.multiEntry,
        };
      });
    const rawRecords = await collectCursor(store);
    await transactionComplete(transaction);
    const records = [];
    for (const record of rawRecords) records.push(await packStructured(record));
    return {
      name: store.name,
      keyPath: cloneKeyPath(store.keyPath),
      autoIncrement: store.autoIncrement,
      indexes,
      records,
    };
  }

  function collectCursor(store) {
    return new Promise((resolve, reject) => {
      const output = [];
      const request = store.openCursor();
      request.onerror = () => reject(request.error || new Error("커서 읽기 실패"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(output);
          return;
        }
        output.push({ key: cursor.key, value: cursor.value });
        cursor.continue();
      };
    });
  }

  async function restoreSnapshot(snapshot, { restoreSessionStorage = false } = {}) {
    restoreStorage(localStorage, snapshot.localStorage || {});
    if (restoreSessionStorage && snapshot.sessionStorage) {
      restoreStorage(sessionStorage, snapshot.sessionStorage);
    }
    for (const database of snapshot.indexedDB || []) {
      await restoreOneDatabase(database);
    }
  }

  function restoreStorage(storage, values) {
    storage.clear();
    for (const [key, value] of Object.entries(values)) {
      storage.setItem(key, value);
    }
  }

  async function restoreOneDatabase(backup) {
    let db;
    const existingInfo =
      typeof indexedDB.databases === "function"
        ? (await indexedDB.databases()).find((info) => info.name === backup.name)
        : null;

    if (!existingInfo) {
      db = await openDatabaseWithSchema(backup.name, Math.max(1, backup.version || 1), backup);
    } else {
      db = await openDatabase(backup.name);
      const needsUpgrade = schemaNeedsUpgrade(db, backup);
      const targetVersion = Math.max(db.version + (needsUpgrade ? 1 : 0), backup.version || 1);
      if (targetVersion > db.version) {
        db.close();
        db = await openDatabaseWithSchema(backup.name, targetVersion, backup);
      }
    }

    try {
      const storeNames = backup.stores
        .map((store) => store.name)
        .filter((name) => db.objectStoreNames.contains(name));
      if (!storeNames.length) return;

      const decodedStores = [];
      for (const storeBackup of backup.stores) {
        if (!db.objectStoreNames.contains(storeBackup.name)) continue;
        const records = [];
        for (const packedRecord of storeBackup.records || []) {
          records.push(await unpackStructured(packedRecord));
        }
        decodedStores.push({ storeBackup, records });
      }

      const transaction = db.transaction(storeNames, "readwrite");
      for (const { storeBackup, records } of decodedStores) {
        const store = transaction.objectStore(storeBackup.name);
        store.clear();
        for (const record of records) {
          if (store.keyPath === null) store.put(record.value, record.key);
          else store.put(record.value);
        }
      }
      await transactionComplete(transaction);
    } finally {
      db.close();
    }
  }

  function schemaNeedsUpgrade(db, backup) {
    for (const storeBackup of backup.stores || []) {
      if (!db.objectStoreNames.contains(storeBackup.name)) return true;
      const transaction = db.transaction(storeBackup.name, "readonly");
      const store = transaction.objectStore(storeBackup.name);
      if (
        JSON.stringify(cloneKeyPath(store.keyPath)) !== JSON.stringify(storeBackup.keyPath) ||
        store.autoIncrement !== storeBackup.autoIncrement
      ) {
        return true;
      }
      for (const indexBackup of storeBackup.indexes || []) {
        if (!store.indexNames.contains(indexBackup.name)) return true;
        const index = store.index(indexBackup.name);
        if (
          JSON.stringify(cloneKeyPath(index.keyPath)) !== JSON.stringify(indexBackup.keyPath) ||
          index.unique !== indexBackup.unique ||
          index.multiEntry !== indexBackup.multiEntry
        ) {
          return true;
        }
      }
    }
    return false;
  }

  function openDatabaseWithSchema(name, version, backup) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);
      request.onerror = () => reject(request.error || new Error(`${name} 열기 실패`));
      request.onblocked = () => reject(new Error(`${name}을 사용 중인 다른 탭을 닫아주세요.`));
      request.onupgradeneeded = () => applySchema(request.result, request.transaction, backup);
      request.onsuccess = () => resolve(request.result);
    });
  }

  function applySchema(db, transaction, backup) {
    for (const storeBackup of backup.stores || []) {
      let store;
      if (db.objectStoreNames.contains(storeBackup.name)) {
        store = transaction.objectStore(storeBackup.name);
        const mismatched =
          JSON.stringify(cloneKeyPath(store.keyPath)) !== JSON.stringify(storeBackup.keyPath) ||
          store.autoIncrement !== storeBackup.autoIncrement;
        if (mismatched) {
          db.deleteObjectStore(storeBackup.name);
          store = createStore(db, storeBackup);
        }
      } else {
        store = createStore(db, storeBackup);
      }

      for (const indexBackup of storeBackup.indexes || []) {
        if (store.indexNames.contains(indexBackup.name)) {
          const index = store.index(indexBackup.name);
          const mismatched =
            JSON.stringify(cloneKeyPath(index.keyPath)) !== JSON.stringify(indexBackup.keyPath) ||
            index.unique !== indexBackup.unique ||
            index.multiEntry !== indexBackup.multiEntry;
          if (mismatched) store.deleteIndex(indexBackup.name);
          else continue;
        }
        store.createIndex(indexBackup.name, indexBackup.keyPath, {
          unique: indexBackup.unique,
          multiEntry: indexBackup.multiEntry,
        });
      }
    }
  }

  function createStore(db, backup) {
    const options = { autoIncrement: Boolean(backup.autoIncrement) };
    if (backup.keyPath !== null && backup.keyPath !== undefined) {
      options.keyPath = backup.keyPath;
    }
    return db.createObjectStore(backup.name, options);
  }

  function openDatabase(name) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onerror = () => reject(request.error || new Error(`${name} 열기 실패`));
      request.onsuccess = () => resolve(request.result);
    });
  }

  function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB 작업 실패"));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB 작업 중단"));
    });
  }

  function cloneKeyPath(keyPath) {
    return Array.isArray(keyPath) ? [...keyPath] : keyPath;
  }

  async function packStructured(root) {
    const seen = new Map();
    let nextId = 1;

    async function encode(value) {
      if (value === undefined) return { $type: "Undefined" };
      if (typeof value === "bigint") return { $type: "BigInt", value: value.toString() };
      if (typeof value === "number" && !Number.isFinite(value)) {
        return { $type: "Number", value: String(value) };
      }
      if (value === null || typeof value !== "object") return value;
      if (seen.has(value)) return { $ref: seen.get(value) };

      const id = nextId++;
      seen.set(value, id);
      if (value instanceof Date) return { $id: id, $type: "Date", value: value.toISOString() };
      if (value instanceof RegExp) {
        return { $id: id, $type: "RegExp", source: value.source, flags: value.flags };
      }
      if (value instanceof URL) return { $id: id, $type: "URL", value: value.href };
      if (typeof File !== "undefined" && value instanceof File) {
        return {
          $id: id,
          $type: "File",
          name: value.name,
          mime: value.type,
          lastModified: value.lastModified,
          data: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
        };
      }
      if (value instanceof Blob) {
        return {
          $id: id,
          $type: "Blob",
          mime: value.type,
          data: bytesToBase64(new Uint8Array(await value.arrayBuffer())),
        };
      }
      if (value instanceof ArrayBuffer) {
        return { $id: id, $type: "ArrayBuffer", data: bytesToBase64(new Uint8Array(value)) };
      }
      if (ArrayBuffer.isView(value)) {
        const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return {
          $id: id,
          $type: "TypedArray",
          name: value.constructor.name,
          data: bytesToBase64(bytes),
        };
      }
      if (value instanceof Map) {
        const entries = [];
        for (const [key, item] of value) entries.push([await encode(key), await encode(item)]);
        return { $id: id, $type: "Map", entries };
      }
      if (value instanceof Set) {
        const values = [];
        for (const item of value) values.push(await encode(item));
        return { $id: id, $type: "Set", values };
      }
      if (Array.isArray(value)) {
        const values = [];
        for (const item of value) values.push(await encode(item));
        return { $id: id, $type: "Array", values };
      }

      const entries = [];
      for (const key of Object.keys(value).sort()) entries.push([key, await encode(value[key])]);
      return { $id: id, $type: "Object", entries };
    }

    return encode(root);
  }

  async function unpackStructured(root) {
    const refs = new Map();

    async function decode(node) {
      if (node === null || typeof node !== "object") return node;
      if (Object.hasOwn(node, "$ref")) {
        if (!refs.has(node.$ref)) throw new Error("손상된 IndexedDB 참조입니다.");
        return refs.get(node.$ref);
      }
      switch (node.$type) {
        case "Undefined":
          return undefined;
        case "BigInt":
          return BigInt(node.value);
        case "Number":
          return Number(node.value);
        case "Date": {
          const value = new Date(node.value);
          refs.set(node.$id, value);
          return value;
        }
        case "RegExp": {
          const value = new RegExp(node.source, node.flags);
          refs.set(node.$id, value);
          return value;
        }
        case "URL": {
          const value = new URL(node.value);
          refs.set(node.$id, value);
          return value;
        }
        case "File": {
          const bytes = base64ToBytes(node.data);
          const value =
            typeof File !== "undefined"
              ? new File([bytes], node.name, { type: node.mime, lastModified: node.lastModified })
              : new Blob([bytes], { type: node.mime });
          refs.set(node.$id, value);
          return value;
        }
        case "Blob": {
          const value = new Blob([base64ToBytes(node.data)], { type: node.mime });
          refs.set(node.$id, value);
          return value;
        }
        case "ArrayBuffer": {
          const value = base64ToBytes(node.data).buffer;
          refs.set(node.$id, value);
          return value;
        }
        case "TypedArray": {
          const bytes = base64ToBytes(node.data);
          let value;
          if (node.name === "DataView") value = new DataView(bytes.buffer);
          else {
            const Constructor = globalThis[node.name];
            if (typeof Constructor !== "function") throw new Error(`지원하지 않는 배열: ${node.name}`);
            value = new Constructor(bytes.buffer);
          }
          refs.set(node.$id, value);
          return value;
        }
        case "Map": {
          const value = new Map();
          refs.set(node.$id, value);
          for (const [key, item] of node.entries) value.set(await decode(key), await decode(item));
          return value;
        }
        case "Set": {
          const value = new Set();
          refs.set(node.$id, value);
          for (const item of node.values) value.add(await decode(item));
          return value;
        }
        case "Array": {
          const value = [];
          refs.set(node.$id, value);
          for (const item of node.values) value.push(await decode(item));
          return value;
        }
        case "Object": {
          const value = {};
          refs.set(node.$id, value);
          for (const [key, item] of node.entries) value[key] = await decode(item);
          return value;
        }
        default:
          throw new Error(`알 수 없는 IndexedDB 형식: ${node.$type}`);
      }
    }

    return decode(root);
  }

  async function encryptSnapshot(snapshot) {
    const credentials = await getCredentials();
    const plainText = JSON.stringify(snapshot);
    let bytes = new TextEncoder().encode(plainText);
    let compression = "none";
    if (typeof CompressionStream === "function") {
      bytes = new Uint8Array(
        await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
      );
      compression = "gzip";
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, credentials.aesKey, bytes);
    return {
      version: 1,
      algorithm: "AES-GCM",
      compression,
      iv: bytesToBase64(iv),
      data: bytesToBase64(new Uint8Array(cipher)),
    };
  }

  async function decryptSnapshot(envelopeInput) {
    const envelope = typeof envelopeInput === "string" ? JSON.parse(envelopeInput) : envelopeInput;
    if (envelope?.version !== 1 || envelope.algorithm !== "AES-GCM") {
      throw new Error("지원하지 않는 암호화 형식입니다.");
    }
    const credentials = await getCredentials();
    let plain;
    try {
      plain = new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: base64ToBytes(envelope.iv) },
          credentials.aesKey,
          base64ToBytes(envelope.data),
        ),
      );
    } catch {
      throw new Error("복호화에 실패했습니다. PC와 휴대폰의 동기화 키를 확인하세요.");
    }
    if (envelope.compression === "gzip") {
      if (typeof DecompressionStream !== "function") {
        throw new Error("이 브라우저는 gzip 복원을 지원하지 않습니다.");
      }
      plain = new Uint8Array(
        await new Response(
          new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip")),
        ).arrayBuffer(),
      );
    }
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function getCredentials() {
    const syncKey = getSetting(KEYS.syncKey, "");
    if (!syncKey) throw new Error("동기화 키가 설정되지 않았습니다.");
    const cacheId = `${location.origin}\u0000${syncKey}`;
    if (runtime.credentialCache?.cacheId === cacheId) return runtime.credentialCache;

    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(syncKey),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const rootBytes = new Uint8Array(await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 180_000,
        salt: new TextEncoder().encode(`site-storage-sync\u0000${location.origin}`),
      },
      material,
      512,
    ));
    const aesKey = await crypto.subtle.importKey(
      "raw",
      rootBytes.slice(0, 32),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const secretBytes = rootBytes.slice(32);
    const roomBytes = await labeledDigest("room", secretBytes);
    const authBytes = await labeledDigest("auth", secretBytes);
    runtime.credentialCache = {
      cacheId,
      roomId: bytesToHex(roomBytes),
      authToken: bytesToBase64Url(authBytes),
      aesKey,
    };
    return runtime.credentialCache;
  }

  async function hashSnapshot(snapshot) {
    const stable = {
      format: snapshot.format,
      version: snapshot.version,
      origin: snapshot.origin,
      localStorage: snapshot.localStorage,
      sessionStorage: snapshot.sessionStorage,
      indexedDB: snapshot.indexedDB,
    };
    return sha256Hex(JSON.stringify(stable));
  }

  function validateSnapshot(snapshot, requireSameOrigin = true) {
    if (!snapshot || snapshot.format !== FORMAT || snapshot.version !== FORMAT_VERSION) {
      throw new Error("지원하지 않는 저장소 백업 형식입니다.");
    }
    if (requireSameOrigin && snapshot.origin !== location.origin) {
      throw new Error(`다른 사이트의 데이터입니다: ${snapshot.origin}`);
    }
  }

  async function sha256Bytes(value) {
    return new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  }

  async function labeledDigest(label, bytes) {
    const prefix = new TextEncoder().encode(`${label}\u0000`);
    const input = new Uint8Array(prefix.length + bytes.length);
    input.set(prefix);
    input.set(bytes, prefix.length);
    return new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  }

  async function sha256Hex(value) {
    return bytesToHex(await sha256Bytes(value));
  }

  function bytesToHex(bytes) {
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const size = 0x8000;
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size));
    }
    return btoa(binary);
  }

  function bytesToBase64Url(bytes) {
    return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  function httpRequest(details) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: REQUEST_TIMEOUT_MS,
        ...details,
        onload: resolve,
        onerror: () => reject(new Error("클라우드 서버에 연결하지 못했습니다.")),
        ontimeout: () => reject(new Error("클라우드 서버 응답 시간이 초과되었습니다.")),
        onabort: () => reject(new Error("클라우드 요청이 취소되었습니다.")),
      });
    });
  }

  function httpError(response) {
    let message = `클라우드 서버 오류 HTTP ${response.status}`;
    try {
      const body = JSON.parse(response.responseText);
      if (body.error) message += ` · ${body.error}`;
    } catch {
      // JSON 오류 본문이 아니면 상태 코드만 표시합니다.
    }
    return new Error(message);
  }

  function endpoint(roomId) {
    return `${normalizeCloudUrl(getSetting(KEYS.cloudUrl, ""))}/v1/sync/${roomId}`;
  }

  function normalizeCloudUrl(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  function ensureDeviceId() {
    let value = getSetting(KEYS.deviceId, "");
    if (!value) {
      value = typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12)))}`;
      setSetting(KEYS.deviceId, value);
    }
    return value;
  }

  function setStatus(message) {
    setSetting(KEYS.lastStatus, `${message} · ${new Date().toLocaleString()}`);
  }

  function notify(text) {
    try {
      GM_notification({ title: "저장소 동기화", text, timeout: 5_000 });
    } catch {
      console.info(`[Storage Sync] ${text}`);
    }
  }

  function downloadJson(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.hidden = true;
    (document.documentElement || document).appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      anchor.remove();
      URL.revokeObjectURL(url);
    }, 10_000);
  }

  function fileTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function getSetting(key, fallback) {
    try {
      const value = GM_getValue(key);
      return value === undefined ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function setSetting(key, value) {
    GM_setValue(key, value);
  }

  function deleteSetting(key) {
    GM_deleteValue(key);
  }
})();
