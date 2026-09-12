/**
 * SaveSync Client Application — GitHub Light Edition with Lucide Icons
 */

const state = {
  games: [],
  statusFilter: 'all', // 'all' | 'remote_newer' | 'local_newer' | 'synced'
  searchQuery: '',
  github: null,
  activeConflictGame: null,
  loading: false
};

// DOM Elements
const el = {
  githubBanner: document.getElementById('github-banner'),
  githubConnected: document.getElementById('github-connected'),
  githubRepoText: document.getElementById('github-repo-text'),
  searchInput: document.getElementById('search-input'),
  clearSearch: document.getElementById('clear-search'),
  countFound: document.getElementById('count-found'),
  countAll: document.getElementById('count-all'),
  manifestCount: document.getElementById('manifest-count'),
  gameList: document.getElementById('game-list'),
  loadingState: document.getElementById('loading-state'),
  emptyState: document.getElementById('empty-state'),
  btnSyncAll: document.getElementById('btn-sync-all'),
  btnRefresh: document.getElementById('btn-refresh'),
  btnUpdateManifest: document.getElementById('btn-update-manifest'),
  conflictModal: document.getElementById('conflict-modal'),
  conflictGameTitle: document.getElementById('conflict-game-title'),
  conflictLocalInfo: document.getElementById('conflict-local-info'),
  conflictRemoteInfo: document.getElementById('conflict-remote-info'),
  btnConflictCancel: document.getElementById('btn-conflict-cancel'),
  btnConflictLocal: document.getElementById('btn-conflict-local'),
  btnConflictRemote: document.getElementById('btn-conflict-remote'),
  toastContainer: document.getElementById('toast-container'),
  filterTabs: document.querySelectorAll('.filter-tab')
};

// Utilities
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(isoString) {
  if (!isoString) return 'Never';
  const d = new Date(isoString);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let iconName = 'info';
  if (type === 'success') iconName = 'check-circle-2';
  if (type === 'error') iconName = 'alert-triangle';

  toast.innerHTML = `<i data-lucide="${iconName}" class="icon-sm"></i> <span>${message}</span>`;
  el.toastContainer.appendChild(toast);
  refreshIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// API Calls
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.success) {
      state.github = data.github;
      updateGitHubStatusUI();
      if (data.manifest && data.manifest.gameCount) {
        if (el.manifestCount) {
          el.manifestCount.textContent = data.manifest.gameCount.toLocaleString();
        }
      }
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

function updateGitHubStatusUI() {
  if (!state.github || !state.github.configured) {
    el.githubBanner.classList.remove('hidden');
    el.githubConnected.classList.add('hidden');
  } else {
    el.githubBanner.classList.add('hidden');
    el.githubConnected.classList.remove('hidden');
    const repoStatus = state.github.repoStatus;
    if (repoStatus && repoStatus.accessible) {
      el.githubRepoText.textContent = `Storage: ${state.github.owner}/${state.github.repo} (${repoStatus.private ? 'Private' : 'Public'})`;
    } else {
      el.githubRepoText.textContent = `Storage: ${state.github.owner}/${state.github.repo} (Connecting...)`;
    }
  }
  refreshIcons();
}

async function loadGames(forceRescan = false) {
  el.loadingState.classList.remove('hidden');
  el.emptyState.classList.add('hidden');
  el.gameList.innerHTML = '';

  try {
    const url = forceRescan ? '/api/games?rescan=true' : '/api/games';
    const res = await fetch(url);
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error);
    }

    state.games = data.games || [];
    if (data.manifestTotal && el.manifestCount) {
      el.manifestCount.textContent = data.manifestTotal.toLocaleString();
    }
    updateCounts();
    renderGameList();

    // Asynchronously update sync statuses for installed games
    checkSyncStatuses();
  } catch (err) {
    showToast('Failed to load games: ' + err.message, 'error');
  } finally {
    el.loadingState.classList.add('hidden');
  }
}

function updateCounts() {
  const foundCount = state.games.length;
  if (el.countFound) el.countFound.textContent = foundCount;
  if (el.countAll) el.countAll.textContent = foundCount;
}

async function checkSyncStatuses() {
  try {
    const res = await fetch('/api/games-status');
    const data = await res.json();
    if (data.success && data.statuses) {
      for (const game of state.games) {
        const st = data.statuses[game.id];
        if (st) {
          game.syncState = st.state;
          game.remoteMeta = st.remote;
        }
      }
      renderGameList();
    }
  } catch (err) {
    console.warn('Batch status check error:', err);
  }
}

function getStatusBadge(game) {
  const s = game.syncState;
  if (!game.saveFound && !game.localBackup && (!s || s === 'NOT_FOUND')) {
    return { cls: 'badge-not-found', icon: 'minus-circle', text: 'Not Detected' };
  }
  if (s === 'SYNCED') {
    return { cls: 'badge-synced', icon: 'check-circle-2', text: 'Synced' };
  }
  if (s === 'LOCAL_ONLY') {
    return { cls: 'badge-local-only', icon: 'hard-drive', text: 'Local Only' };
  }
  if (s === 'LOCAL_NEWER') {
    return { cls: 'badge-local-newer', icon: 'hard-drive', text: 'Local Changes' };
  }
  if (s === 'REMOTE_ONLY') {
    return { cls: 'badge-remote-only', icon: 'cloud', text: 'Remote Only' };
  }
  if (s === 'REMOTE_NEWER') {
    return { cls: 'badge-remote-newer', icon: 'cloud-download', text: 'Remote Update' };
  }
  if (s === 'CONFLICT') {
    return { cls: 'badge-conflict', icon: 'alert-triangle', text: 'Conflict' };
  }
  if (game.saveFound) {
    return { cls: 'badge-local-only', icon: 'hard-drive', text: 'Save Found' };
  }
  return { cls: 'badge-not-found', icon: 'minus-circle', text: 'No Save' };
}

function renderGameList() {
  el.gameList.innerHTML = '';

  const q = state.searchQuery.toLowerCase().trim();
  const filter = state.statusFilter;

  const filtered = state.games.filter(game => {
    // Search query filter
    const matchSearch = !q || game.name.toLowerCase().includes(q);
    if (!matchSearch) return false;

    // Status tab filter
    if (filter === 'all') return true;
    if (filter === 'remote_newer') return game.syncState === 'REMOTE_NEWER';
    if (filter === 'local_newer') return game.syncState === 'LOCAL_NEWER' || game.syncState === 'LOCAL_ONLY';
    if (filter === 'synced') return game.syncState === 'SYNCED';

    return true;
  });

  if (filtered.length === 0) {
    el.emptyState.classList.remove('hidden');
    return;
  }
  el.emptyState.classList.add('hidden');

  filtered.forEach(game => {
    const item = document.createElement('div');
    item.className = 'game-item';
    item.id = `game-${game.id}`;

    const badge = getStatusBadge(game);
    const sizeText = game.saveFound ? formatBytes(game.totalSize) : (game.localBackup ? formatBytes(game.localBackup.size) : '0 B');
    const modifiedText = game.lastModified ? `Modified: ${formatDate(game.lastModified)}` : (game.localBackup ? `Backup: ${formatDate(game.localBackup.updatedAt)}` : '');

    item.innerHTML = `
      <div class="game-info">
        <div class="game-header">
          <span class="game-title" title="${game.name}">${game.name}</span>
          <span class="badge ${badge.cls}" id="badge-${game.id}">
            <i data-lucide="${badge.icon}" class="icon-xs"></i>
            <span>${badge.text}</span>
          </span>
        </div>
        <div class="game-meta">
          <span class="game-size">${sizeText}</span>
          ${modifiedText ? `<span class="meta-separator">&bull;</span> <span>${modifiedText}</span>` : ''}
        </div>
      </div>
      <div class="game-actions">
        <!-- Open folder shortcut -->
        ${game.saveFound ? `
          <button class="btn btn-secondary btn-sm btn-icon-only btn-open-folder" data-id="${game.id}" title="Mở thư mục save trong Windows Explorer">
            <i data-lucide="folder" class="icon-sm"></i>
          </button>
        ` : ''}

        <!-- Local operations -->
        <div class="action-group" title="Local operations">
          <button class="btn btn-secondary btn-sm btn-local-backup" data-id="${game.id}" ${!game.saveFound ? 'disabled' : ''} title="Tải file backup ZIP về máy tính">
            <i data-lucide="download" class="icon-xs"></i>
            Backup Local
          </button>
          <button class="btn btn-secondary btn-sm btn-local-restore" data-id="${game.id}" title="Chọn file backup ZIP từ máy để khôi phục">
            <i data-lucide="upload" class="icon-xs"></i>
            Restore Local
          </button>
        </div>

        <!-- GitHub cloud operations -->
        <div class="action-group" title="GitHub cloud operations">
          <button class="btn btn-gh-backup btn-sm btn-github-backup" data-id="${game.id}" ${!game.saveFound ? 'disabled' : ''} title="Đẩy bản backup lên GitHub">
            <i data-lucide="cloud-upload" class="icon-xs"></i>
            GitHub Backup
          </button>
          <button class="btn btn-gh-restore btn-sm btn-github-restore" data-id="${game.id}" ${!game.remoteMeta ? 'disabled' : ''} title="Tải bản save từ GitHub về máy">
            <i data-lucide="cloud-download" class="icon-xs"></i>
            GitHub Restore
          </button>
        </div>
      </div>
    `;

    el.gameList.appendChild(item);
  });

  refreshIcons();
}

// Check if game is running before dangerous restore
async function checkProcessBeforeAction(game) {
  try {
    const res = await fetch(`/api/games/${game.id}/process-check`);
    const data = await res.json();
    if (data.success && data.isRunning) {
      const confirmRun = confirm(`⚠️ CẢNH BÁO: Game "${game.name}" (tiến trình: ${data.processName}) đang chạy!\n\nKhôi phục save khi game đang mở có thể làm hỏng save hoặc văng game.\nBạn có chắc muốn tiếp tục không?`);
      return confirmRun;
    }
  } catch (err) {
    // ignore check failure
  }
  return true;
}

// Action Handlers
async function handleOpenFolder(gameId) {
  try {
    const res = await fetch(`/api/games/${gameId}/open-folder`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);
    showToast(`Đã mở thư mục save trong Explorer`, 'info');
  } catch (err) {
    showToast(`Không thể mở thư mục: ${err.message}`, 'error');
  }
}

async function handleLocalBackup(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const btn = document.querySelector(`#game-${gameId} .btn-local-backup`);
  if (btn) btn.disabled = true;

  showToast(`Đang chuẩn bị file backup cho ${game.name}...`, 'info');

  try {
    const res = await fetch(`/api/games/${gameId}/backup`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    const downloadUrl = `/api/games/${gameId}/download-backup`;
    const tempLink = document.createElement('a');
    tempLink.href = downloadUrl;
    tempLink.download = `${game.id}_backup.zip`;
    document.body.appendChild(tempLink);
    tempLink.click();
    document.body.removeChild(tempLink);

    showToast(`Đã xuất file backup (${formatBytes(data.meta.size)})`, 'success');
    await refreshGameStatus(gameId);
  } catch (err) {
    showToast(`Lỗi backup: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleLocalRestore(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const safe = await checkProcessBeforeAction(game);
  if (!safe) return;

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.zip,application/zip';
  fileInput.style.display = 'none';
  document.body.appendChild(fileInput);

  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    document.body.removeChild(fileInput);
    if (!file) return;

    const confirmed = confirm(`Khôi phục save cho "${game.name}" từ file "${file.name}"?`);
    if (!confirmed) return;

    const btn = document.querySelector(`#game-${gameId} .btn-local-restore`);
    if (btn) btn.disabled = true;

    showToast(`Đang khôi phục từ file...`, 'info');

    try {
      const res = await fetch(`/api/games/${gameId}/restore-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      showToast(`Khôi phục thành công ${data.restoredFiles.length} file cho ${game.name}!`, 'success');
      await loadGames();
    } catch (err) {
      showToast(`Lỗi khôi phục: ${err.message}`, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  };

  fileInput.oncancel = () => {
    document.body.removeChild(fileInput);
  };

  fileInput.click();
}

async function handleGitHubBackup(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const btn = document.querySelector(`#game-${gameId} .btn-github-backup`);
  if (btn) btn.disabled = true;

  showToast(`Đang tải lên GitHub...`, 'info');

  try {
    const res = await fetch(`/api/games/${gameId}/upload`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Đã tải lên GitHub (${formatBytes(data.meta.size)})`, 'success');
    await refreshGameStatus(gameId);
  } catch (err) {
    showToast(`Lỗi tải lên: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleGitHubRestore(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const safe = await checkProcessBeforeAction(game);
  if (!safe) return;

  if (game.saveFound) {
    const confirmed = confirm(`Tải save của "${game.name}" từ GitHub về đè lên máy này?`);
    if (!confirmed) return;
  }

  const btn = document.querySelector(`#game-${gameId} .btn-github-restore`);
  if (btn) btn.disabled = true;

  showToast(`Đang tải từ GitHub...`, 'info');

  try {
    const res = await fetch(`/api/games/${gameId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'remote' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Khôi phục thành công ${data.restoredFiles.length} file từ GitHub!`, 'success');
    await loadGames();
  } catch (err) {
    showToast(`Lỗi tải từ GitHub: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleSync(gameId, resolution = null) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  try {
    const res = await fetch(`/api/games/${gameId}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolution })
    });
    const data = await res.json();

    if (!data.success) {
      if (data.status === 'conflict') {
        openConflictModal(game, data.conflict);
        return;
      }
      throw new Error(data.error || data.message);
    }

    if (data.action === 'uploaded') {
      showToast(`Đã đồng bộ lên GitHub (${game.name})`, 'success');
    } else if (data.action === 'restored') {
      showToast(`Đã đồng bộ từ GitHub về (${game.name})`, 'success');
    } else {
      showToast(`${game.name} đã ở trạng thái đồng bộ`, 'info');
    }

    await refreshGameStatus(gameId);
  } catch (err) {
    showToast(`Lỗi đồng bộ: ${err.message}`, 'error');
  }
}

async function refreshGameStatus(gameId) {
  try {
    const res = await fetch(`/api/games/${gameId}/status`);
    const statusData = await res.json();
    if (statusData.success) {
      const game = state.games.find(g => g.id === gameId);
      if (game) {
        game.syncState = statusData.state;
        game.remoteMeta = statusData.remote;
        if (statusData.local) {
          game.saveFound = statusData.local.saveFound;
          game.totalSize = statusData.local.totalSize;
          game.lastModified = statusData.local.lastModified;
        }
        renderGameList();
      }
    }
  } catch (err) {
    console.warn('Status refresh error:', err);
  }
}

async function handleSyncAll() {
  if (!state.github || !state.github.configured) {
    showToast('Vui lòng cấu hình GitHub trong .env trước khi đồng bộ tất cả', 'error');
    return;
  }

  el.btnSyncAll.disabled = true;
  el.btnSyncAll.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div> Đang đồng bộ...';

  showToast('Bắt đầu đồng bộ tất cả game...', 'info');

  try {
    const res = await fetch('/api/sync', { method: 'POST' });
    const data = await res.json();

    if (!data.success) throw new Error(data.error);

    if (data.conflictsCount > 0) {
      showToast(`Đã đồng bộ xong! Phát hiện ${data.conflictsCount} game bị xung đột cần chọn bản giữ lại.`, 'info');
      if (data.conflicts[0]) {
        const c = data.conflicts[0];
        const g = state.games.find(x => x.id === c.gameId);
        if (g) openConflictModal(g, c.conflict);
      }
    } else {
      showToast(`Đồng bộ thành công tất cả ${data.totalProcessed} game!`, 'success');
    }

    await loadGames();
  } catch (err) {
    showToast(`Đồng bộ tất cả thất bại: ${err.message}`, 'error');
  } finally {
    el.btnSyncAll.disabled = false;
    el.btnSyncAll.innerHTML = '<i data-lucide="refresh-ccw" class="icon-sm"></i> Sync All';
    refreshIcons();
  }
}

function openConflictModal(game, conflictData) {
  state.activeConflictGame = game;
  el.conflictGameTitle.textContent = game.name;

  const localTime = conflictData.local?.lastModified ? formatDate(conflictData.local.lastModified) : 'Không rõ';
  const localSize = conflictData.local ? formatBytes(conflictData.local.totalSize) : '0 B';
  el.conflictLocalInfo.textContent = `Dung lượng: ${localSize} | Ngày sửa: ${localTime}`;

  const remoteTime = conflictData.remote?.updatedAt ? formatDate(conflictData.remote.updatedAt) : 'Không rõ';
  const remoteSize = conflictData.remote ? formatBytes(conflictData.remote.size) : '0 B';
  el.conflictRemoteInfo.textContent = `Dung lượng: ${remoteSize} | Ngày tạo: ${remoteTime}`;

  el.conflictModal.classList.remove('hidden');
  refreshIcons();
}

function closeConflictModal() {
  state.activeConflictGame = null;
  el.conflictModal.classList.add('hidden');
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  fetchStatus();
  loadGames();

  // Search input
  el.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    el.clearSearch.classList.toggle('hidden', !state.searchQuery);
    renderGameList();
  });

  el.clearSearch.addEventListener('click', () => {
    el.searchInput.value = '';
    state.searchQuery = '';
    el.clearSearch.classList.add('hidden');
    renderGameList();
  });

  // Filter tabs
  el.filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      el.filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.statusFilter = tab.dataset.filter;
      renderGameList();
    });
  });

  // Event Delegation on Game List
  el.gameList.addEventListener('click', (e) => {
    const openFolderBtn = e.target.closest('.btn-open-folder');
    if (openFolderBtn) {
      handleOpenFolder(openFolderBtn.dataset.id);
      return;
    }

    const localBackupBtn = e.target.closest('.btn-local-backup');
    if (localBackupBtn) {
      handleLocalBackup(localBackupBtn.dataset.id);
      return;
    }

    const localRestoreBtn = e.target.closest('.btn-local-restore');
    if (localRestoreBtn) {
      handleLocalRestore(localRestoreBtn.dataset.id);
      return;
    }

    const githubBackupBtn = e.target.closest('.btn-github-backup');
    if (githubBackupBtn) {
      handleGitHubBackup(githubBackupBtn.dataset.id);
      return;
    }

    const githubRestoreBtn = e.target.closest('.btn-github-restore');
    if (githubRestoreBtn) {
      handleGitHubRestore(githubRestoreBtn.dataset.id);
      return;
    }
  });

  // Conflict modal buttons
  el.btnConflictCancel.addEventListener('click', closeConflictModal);

  el.btnConflictLocal.addEventListener('click', () => {
    if (state.activeConflictGame) {
      const id = state.activeConflictGame.id;
      closeConflictModal();
      handleSync(id, 'keep_local');
    }
  });

  el.btnConflictRemote.addEventListener('click', () => {
    if (state.activeConflictGame) {
      const id = state.activeConflictGame.id;
      closeConflictModal();
      handleSync(id, 'use_remote');
    }
  });

  // Sync All
  el.btnSyncAll.addEventListener('click', handleSyncAll);

  // Refresh / Rescan
  el.btnRefresh.addEventListener('click', () => {
    showToast('Đang quét lại toàn bộ save...', 'info');
    loadGames(true);
  });

  // Update Manifest
  el.btnUpdateManifest.addEventListener('click', async () => {
    el.btnUpdateManifest.disabled = true;
    el.btnUpdateManifest.textContent = 'Updating...';
    showToast('Đang tải danh mục Ludusavi mới nhất từ GitHub...', 'info');
    try {
      const res = await fetch('/api/manifest/update', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      showToast(`Đã cập nhật danh mục! Tải được ${data.gameCount} games.`, 'success');
      await loadGames();
    } catch (err) {
      showToast(`Cập nhật danh mục thất bại: ${err.message}`, 'error');
    } finally {
      el.btnUpdateManifest.disabled = false;
      el.btnUpdateManifest.innerHTML = '<i data-lucide="refresh-cw" class="icon-sm"></i> Update Manifest';
      refreshIcons();
    }
  });

  refreshIcons();
});
