// ===== グローバル関数を先に登録（HTMLのonclickで使用） =====
window.toggleMode = function () { toggleMode(); };
window.switchToSelection = function () { switchToSelection(); };
window.selectAll = function () { selectAll(); };
window.selectNone = function () { selectNone(); };
window.confirmSelection = function () { confirmSelection(); };
window.toggleOut = function (roomId) { toggleOut(roomId); };
window.editNote = function (roomId) { editNote(roomId); };
window.confirmReset = function () { confirmReset(); };
window.closeModal = function () { closeModal(); };
window.executeReset = function () { executeReset(); };

// ===== グローバル変数 =====
let rooms = [];
let currentMode = 'selection'; // 'selection' or 'management'
let lastActionTime = 0; // 最終操作時刻 (ポーリング競合防止用)

// ===== ユーティリティ =====
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 権限チェック
function isViewer() {
    return localStorage.getItem('auth_role') === 'viewer';
}

function checkAuth() {
    if (isViewer()) {
        showToast('閲覧専用モードのため操作できません', 'error');
        return false;
    }
    return true;
}

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    showLoading();
    try {
        await fetchRooms();
    } catch (e) {
        console.error('fetchRooms failed', e);
        showToast('通信エラーが発生しました', 'error');
    }
    determineInitialMode();

    // 閲覧モード通知
    if (isViewer()) {
        showToast('閲覧専用モードでログイン中', 'info');
        document.body.classList.add('viewer-mode');
    }
}

// モード判定
function determineInitialMode() {
    const hasActiveRooms = rooms.some(r => r.is_active);
    if (hasActiveRooms) {
        switchToManagement();
    } else {
        switchToSelection();
    }
}

// ===== データ取得 (ポーリング) =====
function startPolling() {
    // 3秒ごとに最新データを取得
    setInterval(() => fetchRooms(true), 3000);
}

async function fetchRooms(silent = false) {
    // 操作直後(2秒以内)のポーリングはスキップしてUI上書きを防ぐ
    if (silent && Date.now() - lastActionTime < 2000) {
        return;
    }

    try {
        console.log('Fetching rooms...');
        const response = await fetch('/api/rooms', {
            credentials: 'include'
        });

        console.log('Response status:', response.status);

        if (response.status === 401) {
            // 認証エラーの場合はログインページへ
            console.log('Not authenticated, redirecting to login');
            window.location.href = '/login.html';
            return;
        }

        if (!response.ok) throw new Error('データ取得失敗: ' + response.status);

        const newRooms = await response.json();
        console.log('Rooms received:', newRooms.length);

        // データに変更がある場合のみ更新 (簡易的な等価性チェック)
        if (JSON.stringify(newRooms) !== JSON.stringify(rooms)) {
            rooms = newRooms;
            renderCurrentView();
            updateProgress(); // 進捗バーも更新
        }

        // 接続ステータス表示 (緑の丸)
        updateConnectionStatus('connected');
    } catch (error) {
        console.error('Error fetching rooms:', error);
        if (!silent) showToast('データの取得に失敗しました', 'error');
        updateConnectionStatus('disconnected');
    }
}

function updateConnectionStatus(status) {
    const dot = document.querySelector('.status-dot');
    if (!dot) return;

    dot.className = 'status-dot';
    if (status === 'connected') {
        dot.classList.add('connected');
    } else {
        dot.classList.add('disconnected');
    }
}

// ===== モード切替 =====
function toggleMode() {
    if (currentMode === 'selection') {
        const activeCount = rooms.filter(r => r.is_active).length;
        if (activeCount === 0) {
            showToast('使用する客室を選択してください', 'error');
            return;
        }
        switchToManagement();
    } else {
        switchToSelection();
    }
}

function switchToSelection() {
    currentMode = 'selection';
    document.getElementById('selectionView').classList.remove('hidden');
    document.getElementById('managementView').classList.add('hidden');
    document.getElementById('modeIcon').textContent = '📋';
    renderSelectionView();
}

function switchToManagement() {
    currentMode = 'management';
    document.getElementById('selectionView').classList.add('hidden');
    document.getElementById('managementView').classList.remove('hidden');
    document.getElementById('modeIcon').textContent = '🛏️';
    renderManagementView();
}

function renderCurrentView() {
    if (currentMode === 'selection') {
        renderSelectionView();
    } else {
        renderManagementView();
    }
}

// ===== 選択画面描画 =====
function renderSelectionView() {
    const container = document.getElementById('selectionList');

    const generalRooms = rooms.filter(r => r.category === 'general');
    const specialRooms = rooms.filter(r => r.category === 'special');

    container.innerHTML = `
    <section class="room-category">
      <div class="category-header">
        <span class="category-icon">🏠</span>
        <h2 class="category-title">本館</h2>
      </div>
      <div class="room-grid">
        ${generalRooms.map(room => createSelectionItem(room)).join('')}
      </div>
    </section>
    
    <section class="room-category">
      <div class="category-header">
        <span class="category-icon">🏡</span>
        <h2 class="category-title">別館</h2>
      </div>
      <div class="room-grid">
        ${specialRooms.map(room => createSelectionItem(room)).join('')}
      </div>
    </section>
  `;

    // イベントリスナー
    container.querySelectorAll('.room-item').forEach(item => {
        item.addEventListener('click', () => toggleRoomSelection(item.dataset.roomId));
    });

    updateSelectedCount();
}

function createSelectionItem(room) {
    const selectedClass = room.is_active ? 'selected' : '';
    return `
    <div class="room-item ${selectedClass}" data-room-id="${room.room_id}">
      <span class="room-name">${escapeHtml(room.room_id)}</span>
    </div>
  `;
}

function toggleRoomSelection(roomId) {
    if (!checkAuth()) return;

    const room = rooms.find(r => r.room_id === roomId);
    if (room) {
        lastActionTime = Date.now(); // 操作時刻を記録
        // 楽観的更新: DOM直接操作により最速でUI反映
        const newValue = room.is_active ? 0 : 1;
        room.is_active = newValue;

        const item = document.querySelector(`.room-item[data-room-id="${roomId}"]`);
        if (item) {
            if (newValue) item.classList.add('selected');
            else item.classList.remove('selected');
            updateSelectedCount();
        } else {
            renderSelectionView(); // フォールバック
        }

        // バックグラウンドでサーバー更新
        updateRoom(roomId, { is_active: newValue });
    }
}

function updateSelectedCount() {
    const count = rooms.filter(r => r.is_active).length;
    document.getElementById('selectedCount').textContent = count;
}

function selectAll() {
    if (!checkAuth()) return;
    rooms.forEach(room => {
        if (!room.is_active) {
            room.is_active = 1;
            updateRoom(room.room_id, { is_active: 1 });
        }
    });
    renderSelectionView();
}

function selectNone() {
    if (!checkAuth()) return;
    rooms.forEach(room => {
        if (room.is_active) {
            room.is_active = 0;
            updateRoom(room.room_id, { is_active: 0 });
        }
    });
    renderSelectionView();
}

function confirmSelection() {
    const activeCount = rooms.filter(r => r.is_active).length;
    if (activeCount === 0) {
        showToast('使用する客室を選択してください', 'error');
        return;
    }
    switchToManagement();
    showToast(`${activeCount}室を選択しました`, 'success');
}

// ===== 管理画面描画 =====
function renderManagementView() {
    const container = document.getElementById('managementList');

    // アクティブな部屋をソート（本館優先、その中で表示順）
    const activeRooms = rooms.filter(r => r.is_active);

    if (activeRooms.length === 0) {
        container.innerHTML = `
            <div class="loading">
                <p class="loading-text">使用客室が選択されていません</p>
                <button class="action-btn action-btn-primary" onclick="switchToSelection()">客室を選択する</button>
            </div>
        `;
        return;
    }

    let html = `
        <div class="room-list-header">
            <div>部屋番号</div>
            <div>アウト状況</div>
            <div>コメント</div>
        </div>
        <div class="room-list-body">
            ${activeRooms.map(room => createRoomRow(room)).join('')}
        </div>
    `;

    container.innerHTML = html;
    updateProgress();
}

function createRoomRow(room) {
    const isOut = room.is_checkout === 1;
    const note = room.notes || '';

    // ステータスアイコンのHTML
    const statusIcon = isOut
        ? '<div class="status-out"></div>'
        : '<div class="status-stay"></div>'; // 三角

    // 時刻フォーマット (例: 14:30)
    let timeStr = '';
    if (room.updated_at) {
        try {
            const date = new Date(room.updated_at);
            timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        } catch (e) {
            console.error('Date parse error', e);
        }
    }

    return `
    <div class="room-row" data-room-id="${room.room_id}">
        <div class="col-room">${escapeHtml(room.room_id)}</div>
        <div class="col-status" onclick="toggleOut('${room.room_id}')">
            <div class="status-icon-wrapper">
                ${statusIcon}
            </div>
            <div class="last-update">${timeStr}</div>
        </div>
        <div class="col-note" onclick="editNote('${room.room_id}')">
            <span class="note-text">${note ? escapeHtml(note) : '<span style="color:#ccc;font-size:0.8rem">未入力</span>'}</span>
        </div>
    </div>
    `;
}

// 備考編集機能
function editNote(roomId) {
    if (!checkAuth()) return;

    const room = rooms.find(r => r.room_id === roomId);
    if (!room) return;

    // シンプルにpromptを使用
    const newNote = prompt('備考を入力してください', room.notes || '');
    if (newNote !== null && newNote !== room.notes) {
        // 楽観的更新
        room.notes = newNote;

        const row = document.querySelector(`.room-row[data-room-id="${roomId}"]`);
        if (row) {
            const noteEl = row.querySelector('.note-text');
            noteEl.innerHTML = newNote ? escapeHtml(newNote) : '<span style="color:#ccc;font-size:0.8rem">未入力</span>';
        }

        updateRoom(roomId, { notes: newNote });
    }
}

function toggleOut(roomId) {
    if (!checkAuth()) return;

    const room = rooms.find(r => r.room_id === roomId);
    if (room) {
        lastActionTime = Date.now(); // 操作時刻を記録
        // 楽観的更新
        const newValue = room.is_checkout ? 0 : 1;
        room.is_checkout = newValue;

        // DOM更新
        const row = document.querySelector(`.room-row[data-room-id="${roomId}"]`);
        if (row) {
            const iconWrapper = row.querySelector('.status-icon-wrapper');
            if (newValue) {
                // OUTになった
                iconWrapper.innerHTML = '<div class="status-out"></div>';
            } else {
                // キャンセル
                iconWrapper.innerHTML = '<div class="status-stay"></div>';
            }
            updateProgress();
        } else {
            // 安全策
            renderManagementView();
        }

        // バックグラウンドでサーバー更新
        updateRoom(roomId, { is_checkout: newValue });
    }
}

function updateProgress() {
    const activeRooms = rooms.filter(r => r.is_active);
    const outCount = activeRooms.filter(r => r.is_checkout).length;
    const total = activeRooms.length;

    document.getElementById('outCount').textContent = outCount;
    document.getElementById('totalActiveCount').textContent = total;

    const percentage = total > 0 ? (outCount / total) * 100 : 0;
    document.getElementById('progressFill').style.width = `${percentage}%`;
}

// ===== API呼び出し =====
async function updateRoom(roomId, updates) {
    try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });

        if (!response.ok) throw new Error('更新失敗');

        const updatedRoom = await response.json();
        updateRoomInList(updatedRoom);
        renderCurrentView();
    } catch (error) {
        console.error('Error updating room:', error);
        showToast('更新に失敗しました', 'error');
        await fetchRooms();
    }
}

function updateRoomInList(updatedRoom) {
    const index = rooms.findIndex(r => r.room_id === updatedRoom.room_id);
    if (index !== -1) {
        rooms[index] = updatedRoom;
    }
}

// ===== リセット機能 =====
function confirmReset() {
    document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

async function executeReset() {
    if (!checkAuth()) return;

    closeModal();

    try {
        const response = await fetch('/api/reset', {
            method: 'POST'
        });

        if (!response.ok) throw new Error('リセット失敗');

        showToast('全ステータスをリセットしました', 'success');
    } catch (error) {
        console.error('Error resetting:', error);
        showToast('リセットに失敗しました', 'error');
    }
}

// ===== ユーティリティ =====
function showLoading() {
    const selectionList = document.getElementById('selectionList');
    if (selectionList) {
        selectionList.innerHTML = `
      <div class="loading">
        <div class="loading-spinner"></div>
        <span class="loading-text">読み込み中...</span>
      </div>
    `;
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
