// ===== グローバル変数 =====
let rooms = [];
let currentMode = 'selection'; // 'selection' or 'management'
let lastActionTime = 0; // 最終操作時刻 (ポーリング競合防止用)

// ===== 初期化 =====
document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

async function initApp() {
    showLoading();
    await fetchRooms();
    startPolling();
    determineInitialMode();
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
        const response = await fetch('/api/rooms');
        if (!response.ok) throw new Error('データ取得失敗');

        const newRooms = await response.json();

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
    const room = rooms.find(r => r.room_id === roomId);
    if (room) {
        lastActionTime = Date.now(); // 操作時刻を記録
        // 楽観的更新: APIを待たずにUIを変更
        const newValue = room.is_active ? 0 : 1;
        room.is_active = newValue;
        renderSelectionView(); // 即座に再描画
        updateSelectedCount();

        // バックグラウンドでサーバー更新
        updateRoom(roomId, { is_active: newValue });
    }
}

function updateSelectedCount() {
    const count = rooms.filter(r => r.is_active).length;
    document.getElementById('selectedCount').textContent = count;
}

function selectAll() {
    rooms.forEach(room => {
        if (!room.is_active) {
            room.is_active = 1;
            updateRoom(room.room_id, { is_active: 1 });
        }
    });
    renderSelectionView();
}

function selectNone() {
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

    const activeRooms = rooms.filter(r => r.is_active);
    const generalRooms = activeRooms.filter(r => r.category === 'general');
    const specialRooms = activeRooms.filter(r => r.category === 'special');

    let html = '';

    if (generalRooms.length > 0) {
        html += `
      <section class="room-category">
        <div class="category-header">
          <span class="category-icon">🏠</span>
          <h2 class="category-title">本館</h2>
          <span class="category-count">${generalRooms.length}室</span>
        </div>
        <div class="room-cards">
          ${generalRooms.map(room => createRoomCard(room)).join('')}
        </div>
      </section>
    `;
    }

    if (specialRooms.length > 0) {
        html += `
      <section class="room-category">
        <div class="category-header">
          <span class="category-icon">🏡</span>
          <h2 class="category-title">別館</h2>
          <span class="category-count">${specialRooms.length}室</span>
        </div>
        <div class="room-cards">
          ${specialRooms.map(room => createRoomCard(room)).join('')}
        </div>
      </section>
    `;
    }

    if (activeRooms.length === 0) {
        html = `
      <div class="loading">
        <p class="loading-text">使用客室が選択されていません</p>
        <button class="action-btn action-btn-primary" onclick="switchToSelection()">客室を選択する</button>
      </div>
    `;
    }

    container.innerHTML = html;

    // イベントリスナー
    attachManagementEventListeners();
    updateProgress();
}

function createRoomCard(room) {
    const outClass = room.is_checkout ? 'out-complete' : '';
    const btnClass = room.is_checkout ? 'checked' : '';
    const hasNotes = room.notes && room.notes.trim() !== '';

    return `
    <div class="room-card ${outClass}" data-room-id="${room.room_id}">
      <div class="room-card-content">
        <span class="room-name">${escapeHtml(room.room_id)}</span>
        <button class="out-button ${btnClass}" 
                data-room-id="${room.room_id}"
                onclick="toggleOut('${room.room_id}')">
          <span class="btn-icon">${room.is_checkout ? '✅' : '🚪'}</span>
          <span>${room.is_checkout ? 'OUT済み' : 'OUT'}</span>
        </button>
      </div>
      <div class="notes-section">
        <div class="notes-wrapper">
          <span class="notes-icon ${hasNotes ? 'has-notes' : ''}">📝</span>
          <input type="text" 
                 class="notes-input" 
                 placeholder="備考を入力..."
                 value="${escapeHtml(room.notes || '')}"
                 data-room-id="${room.room_id}">
        </div>
      </div>
    </div>
  `;
}

function attachManagementEventListeners() {
    // 備考入力
    document.querySelectorAll('.management-mode .notes-input').forEach(input => {
        let debounceTimer;
        input.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => handleNotesChange(e), 500);
        });
        input.addEventListener('blur', handleNotesChange);
    });
}

function toggleOut(roomId) {
    const room = rooms.find(r => r.room_id === roomId);
    if (room) {
        lastActionTime = Date.now(); // 操作時刻を記録
        // 楽観的更新: APIを待たずにUIを変更
        const newValue = room.is_checkout ? 0 : 1;
        room.is_checkout = newValue;

        // ボタンのスタイルとアイコンを直接更新 (全体再描画より高速かつちらつきなし)
        // ※ renderCurrentView()を呼んでも良いが、DOM操作で最適化
        const card = document.querySelector(`.room-card[data-room-id="${roomId}"]`);
        if (card) {
            const btn = card.querySelector('.out-button');
            const btnText = btn.querySelector('span:last-child');
            const btnIcon = btn.querySelector('.btn-icon');

            if (newValue) {
                card.classList.add('out-complete');
                btn.classList.add('checked');
                btnText.textContent = 'OUT済み';
                btnIcon.textContent = '✅';
            } else {
                card.classList.remove('out-complete');
                btn.classList.remove('checked');
                btnText.textContent = 'OUT';
                btnIcon.textContent = '🚪';
            }
            updateProgress(); // プログレスバー更新
        } else {
            // カードが見つからない場合は安全策で全体再描画
            renderCurrentView();
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

// ===== イベントハンドラー =====
async function handleNotesChange(event) {
    const input = event.target;
    const roomId = input.dataset.roomId;
    const value = input.value;

    const room = rooms.find(r => r.room_id === roomId);
    if (room && room.notes !== value) {
        await updateRoom(roomId, { notes: value });
    }
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

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// グローバル関数として公開
window.toggleMode = toggleMode;
window.switchToSelection = switchToSelection;
window.selectAll = selectAll;
window.selectNone = selectNone;
window.confirmSelection = confirmSelection;
window.toggleOut = toggleOut;
window.confirmReset = confirmReset;
window.closeModal = closeModal;
window.executeReset = executeReset;
