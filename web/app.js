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
  githubStoragePill: document.getElementById('github-storage-pill'),
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
  confirmModal: document.getElementById('confirm-modal'),
  confirmHeaderIcon: document.getElementById('confirm-header-icon'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmGameTitle: document.getElementById('confirm-game-title'),
  confirmDesc: document.getElementById('confirm-desc'),
  confirmWarningText: document.getElementById('confirm-warning-text'),
  btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
  btnConfirmOk: document.getElementById('btn-confirm-ok'),
  confirmBtnLabel: document.getElementById('confirm-btn-label'),
  confirmBtnIcon: document.getElementById('confirm-btn-icon'),
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

// Debounce helper
function debounce(fn, delay = 150) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Confirm Modal Handler
let pendingConfirmAction = null;

function showConfirmDialog({
  title = 'Confirm Action',
  gameTitle = '',
  desc = '',
  warningText = '',
  btnLabel = 'Confirm',
  btnClass = 'btn-primary',
  btnIcon = 'check',
  headerIconClass = 'warning-icon text-purple',
  onConfirm
}) {
  if (el.confirmTitle) el.confirmTitle.textContent = title;
  if (el.confirmGameTitle) el.confirmGameTitle.textContent = gameTitle;
  if (el.confirmDesc) el.confirmDesc.textContent = desc;
  if (el.confirmWarningText && warningText) el.confirmWarningText.textContent = warningText;
  if (el.confirmBtnLabel) el.confirmBtnLabel.textContent = btnLabel;

  if (el.btnConfirmOk) {
    el.btnConfirmOk.className = `btn ${btnClass}`;
  }

  if (el.confirmBtnIcon) {
    el.confirmBtnIcon.setAttribute('data-lucide', btnIcon);
  }

  if (el.confirmHeaderIcon) {
    el.confirmHeaderIcon.className = headerIconClass;
  }

  pendingConfirmAction = onConfirm;
  if (el.confirmModal) el.confirmModal.classList.remove('hidden');
  refreshIcons();
}

function closeConfirmDialog() {
  if (el.confirmModal) el.confirmModal.classList.add('hidden');
  pendingConfirmAction = null;
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
  if (!el.githubStoragePill) return;

  if (!state.github || !state.github.configured) {
    if (el.githubBanner) el.githubBanner.classList.remove('hidden');
    el.githubStoragePill.className = 'storage-pill not-configured';
    el.githubRepoText.textContent = 'Not Configured';
  } else {
    if (el.githubBanner) el.githubBanner.classList.add('hidden');
    el.githubStoragePill.className = 'storage-pill connected';
    const repoStatus = state.github.repoStatus;
    const repoName = `${state.github.owner}/${state.github.repo}`;
    if (repoStatus && repoStatus.accessible) {
      const visibility = repoStatus.private ? 'Private' : 'Public';
      el.githubRepoText.textContent = `${repoName} (${visibility})`;
    } else {
      el.githubRepoText.textContent = repoName;
    }
  }
  refreshIcons();
}

async function loadGames(forceRescan = false) {
  if (state.games.length === 0) {
    el.loadingState.classList.remove('hidden');
  }
  el.emptyState.classList.add('hidden');

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

    // Hide loading immediately as soon as games are visible
    el.loadingState.classList.add('hidden');

    // Run sync status check asynchronously in background
    checkSyncStatuses();
  } catch (err) {
    showToast('Failed to load games: ' + err.message, 'error');
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
      return true;
    }
  } catch (err) {
    console.warn('Batch status check error:', err);
  }
  return false;
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
          <button class="btn btn-secondary btn-sm btn-icon-only btn-open-folder" data-id="${game.id}" title="Open save folder in Windows Explorer">
            <i data-lucide="folder" class="icon-sm"></i>
          </button>
        ` : ''}

        <!-- Local operations -->
        <div class="action-group" title="Local operations">
          <button class="btn btn-secondary btn-sm btn-local-backup" data-id="${game.id}" ${!game.saveFound ? 'disabled' : ''} title="Download local backup ZIP to PC">
            <i data-lucide="download" class="icon-xs"></i>
            Backup Local
          </button>
          <button class="btn btn-secondary btn-sm btn-local-restore" data-id="${game.id}" title="Select local backup ZIP to restore">
            <i data-lucide="upload" class="icon-xs"></i>
            Restore Local
          </button>
        </div>

        <!-- GitHub cloud operations -->
        <div class="action-group" title="GitHub cloud operations">
          <button class="btn btn-gh-backup btn-sm btn-github-backup" data-id="${game.id}" ${!game.saveFound ? 'disabled' : ''} title="Upload backup to GitHub">
            <i data-lucide="cloud-upload" class="icon-xs"></i>
            GitHub Backup
          </button>
          <button class="btn btn-gh-restore btn-sm btn-github-restore" data-id="${game.id}" ${!game.remoteMeta ? 'disabled' : ''} title="Restore save from GitHub">
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
      const confirmRun = confirm(`⚠️ WARNING: Game "${game.name}" (process: ${data.processName}) is currently running!\n\nRestoring save files while the game is running may cause save corruption or crash.\nAre you sure you want to continue?`);
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
    showToast(`Save folder opened in Explorer`, 'info');
  } catch (err) {
    showToast(`Cannot open folder: ${err.message}`, 'error');
  }
}

async function handleLocalBackup(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const btn = document.querySelector(`#game-${gameId} .btn-local-backup`);
  if (btn) btn.disabled = true;

  showToast(`Preparing backup for ${game.name}...`, 'info');

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

    showToast(`Backup exported (${formatBytes(data.meta.size)})`, 'success');
    await refreshGameStatus(gameId);
  } catch (err) {
    showToast(`Backup error: ${err.message}`, 'error');
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

    const confirmed = confirm(`Restore save files for "${game.name}" from "${file.name}"?`);
    if (!confirmed) return;

    const btn = document.querySelector(`#game-${gameId} .btn-local-restore`);
    if (btn) btn.disabled = true;

    showToast(`Restoring from file...`, 'info');

    try {
      const res = await fetch(`/api/games/${gameId}/restore-file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      showToast(`Successfully restored ${data.restoredFiles.length} files for ${game.name}!`, 'success');
      await loadGames();
    } catch (err) {
      showToast(`Restore error: ${err.message}`, 'error');
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

  const safe = await checkProcessBeforeAction(game);
  if (!safe) return;

  showConfirmDialog({
    title: 'Confirm GitHub Backup',
    gameTitle: game.name,
    desc: `Are you sure you want to upload save files for "${game.name}" to GitHub?`,
    warningText: 'Notice: The existing cloud backup on GitHub will be overwritten with your latest local save data.',
    btnLabel: 'Confirm Backup',
    btnClass: 'btn-primary',
    btnIcon: 'cloud-upload',
    headerIconClass: 'warning-icon text-green',
    onConfirm: async () => {
      await executeGitHubBackup(gameId);
    }
  });
}

async function executeGitHubBackup(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const btn = document.querySelector(`#game-${gameId} .btn-github-backup`);
  if (btn) btn.disabled = true;

  showToast(`Uploading to GitHub (${game.name})...`, 'info');

  try {
    const res = await fetch(`/api/games/${gameId}/upload`, { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Backed up to GitHub (${formatBytes(data.meta?.size || data.meta?.zipSize)})`, 'success');
    await refreshGameStatus(gameId);
  } catch (err) {
    showToast(`Upload error: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleGitHubRestore(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const safe = await checkProcessBeforeAction(game);
  if (!safe) return;

  // Show confirmation popup before restoring
  showConfirmDialog({
    title: 'Confirm GitHub Restore',
    gameTitle: game.name,
    desc: `Are you sure you want to download and restore the save for "${game.name}" from GitHub?`,
    warningText: 'Notice: Your current local save data for this game will be replaced with the cloud backup!',
    btnLabel: 'Confirm Restore',
    btnClass: 'btn-purple',
    btnIcon: 'cloud-download',
    headerIconClass: 'warning-icon text-purple',
    onConfirm: async () => {
      await executeGitHubRestore(gameId);
    }
  });
}

async function executeGitHubRestore(gameId) {
  const game = state.games.find(g => g.id === gameId);
  if (!game) return;

  const btn = document.querySelector(`#game-${gameId} .btn-github-restore`);
  if (btn) btn.disabled = true;

  showToast(`Downloading save for ${game.name} from GitHub...`, 'info');

  try {
    const res = await fetch(`/api/games/${gameId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'remote' })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error);

    showToast(`Successfully restored ${data.restoredFiles.length} files for ${game.name}!`, 'success');
    await loadGames();
  } catch (err) {
    showToast(`GitHub restore error: ${err.message}`, 'error');
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
      showToast(`Synced to GitHub (${game.name})`, 'success');
    } else if (data.action === 'restored') {
      showToast(`Restored from GitHub (${game.name})`, 'success');
    } else {
      showToast(`${game.name} is already up to date`, 'info');
    }

    await refreshGameStatus(gameId);
  } catch (err) {
    showToast(`Sync error: ${err.message}`, 'error');
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
    showToast('Please configure GitHub in .env before syncing all games', 'error');
    return;
  }
  const targetGames = state.games.filter(g => 
    g.syncState === 'LOCAL_NEWER' || 
    g.syncState === 'REMOTE_NEWER' || 
    g.syncState === 'LOCAL_ONLY' || 
    g.syncState === 'REMOTE_ONLY'
  );

  if (targetGames.length === 0) {
    const totalFound = state.games.filter(g => g.saveFound || g.remoteMeta).length;
    if (totalFound === 0) {
      showToast('No detected games found.', 'info');
      return;
    }
    showToast('All games are already up to date!', 'success');
    return;
  }

  el.btnSyncAll.disabled = true;
  el.btnSyncAll.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div> Syncing...';
  showToast(`Syncing ${targetGames.length} games with changes...`, 'info');

  let syncedCount = 0;
  const conflicts = [];

  for (let i = 0; i < targetGames.length; i++) {
    const game = targetGames[i];

    try {
      const res = await fetch(`/api/games/${game.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.status === 'conflict') {
        conflicts.push({ game, conflict: data.conflict });
        game.syncState = 'CONFLICT';
      } else if (data.success) {
        syncedCount++;
        await refreshGameStatus(game.id);
      }
    } catch (err) {
      console.warn(`Sync error for ${game.name}:`, err);
    }
  }

  if (conflicts.length > 0) {
    showToast(`Sync complete! Detected ${conflicts.length} conflicting games requiring review.`, 'warning');
    if (conflicts[0]) {
      openConflictModal(conflicts[0].game, conflicts[0].conflict);
    }
  } else {
    showToast(`Successfully synced all ${syncedCount} games!`, 'success');
  }

  el.btnSyncAll.disabled = false;
  el.btnSyncAll.innerHTML = '<i data-lucide="refresh-ccw" class="icon-sm"></i> Sync All';
  refreshIcons();
  await loadGames();
}

function openConflictModal(game, conflictData) {
  state.activeConflictGame = game;
  el.conflictGameTitle.textContent = game.name;

  const localTime = conflictData.local?.lastModified ? formatDate(conflictData.local.lastModified) : 'Unknown';
  const localSize = conflictData.local ? formatBytes(conflictData.local.totalSize) : '0 B';
  el.conflictLocalInfo.textContent = `Size: ${localSize} | Modified: ${localTime}`;

  const remoteTime = conflictData.remote?.updatedAt ? formatDate(conflictData.remote.updatedAt) : 'Unknown';
  const remoteSize = conflictData.remote ? formatBytes(conflictData.remote.size) : '0 B';
  el.conflictRemoteInfo.textContent = `Size: ${remoteSize} | Updated: ${remoteTime}`;

  el.conflictModal.classList.remove('hidden');
  refreshIcons();
}

function closeConflictModal() {
  state.activeConflictGame = null;
  el.conflictModal.classList.add('hidden');
}// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  fetchStatus();
  loadGames();

  // Search input with 150ms debounce
  const debouncedRender = debounce(() => {
    renderGameList();
  }, 150);

  el.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    el.clearSearch.classList.toggle('hidden', !state.searchQuery);
    debouncedRender();
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

  // Confirm Restore modal buttons
  if (el.btnConfirmCancel) {
    el.btnConfirmCancel.addEventListener('click', closeConfirmDialog);
  }

  if (el.btnConfirmOk) {
    el.btnConfirmOk.addEventListener('click', async () => {
      const action = pendingConfirmAction;
      closeConfirmDialog();
      if (typeof action === 'function') {
        await action();
      }
    });
  }

  // Sync All
  el.btnSyncAll.addEventListener('click', handleSyncAll);

  // Refresh / Rescan
  el.btnRefresh.addEventListener('click', async () => {
    el.btnRefresh.disabled = true;
    el.btnRefresh.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div> Scanning...';
    try {
      await loadGames(true, true);
      showToast(`Scan complete! Found ${state.games.length} games.`, 'success');
    } catch (err) {
      showToast(`Scan error: ${err.message}`, 'error');
    } finally {
      el.btnRefresh.disabled = false;
      el.btnRefresh.innerHTML = '<i data-lucide="radar" class="icon-sm"></i> Rescan';
      refreshIcons();
    }
  });

  // Update Manifest
  el.btnUpdateManifest.addEventListener('click', async () => {
    el.btnUpdateManifest.disabled = true;
    el.btnUpdateManifest.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0"></div> Updating...';
    showToast('Downloading latest Ludusavi Manifest from GitHub...', 'info');

    try {
      const res = await fetch('/api/manifest/update', { method: 'POST' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);

      await loadGames(false, false);
      showToast(`Manifest updated! Loaded ${data.gameCount?.toLocaleString() || ''} games.`, 'success');
    } catch (err) {
      showToast(`Failed to update manifest: ${err.message}`, 'error');
    } finally {
      el.btnUpdateManifest.disabled = false;
      el.btnUpdateManifest.innerHTML = '<i data-lucide="refresh-cw" class="icon-sm"></i> Update Manifest';
      refreshIcons();
    }
  });

  refreshIcons();
});
