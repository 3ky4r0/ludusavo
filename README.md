# SaveSync

> Lightweight personal game-save synchronization using the **Ludusavi manifest** and private **GitHub repository** storage.

---

## Features

* **Ludusavi Manifest as Source of Truth**: Dynamically resolves game save locations across Windows and POSIX systems without hard-coded game paths.
* **Private GitHub Storage**: Backs up saves to a single private GitHub repository using the GitHub REST API. Tokens exist solely on the local Node.js backend.
* **ZIP Archives with SHA-256 Integrity**: Creates standalone `.zip` archives with portable path mappings (`<home>`, `<appdata>`, `<winDocuments>`) and validates cryptographic SHA-256 hashes before any restore.
* **Conflict Prevention**: Detects local vs remote divergence (`SYNCED`, `LOCAL_ONLY`, `REMOTE_ONLY`, `LOCAL_NEWER`, `REMOTE_NEWER`, `CONFLICT`) and never silently overwrites conflicting saves.
* **Minimal Dark-Mode Web UI**: Fast, responsive, lightweight UI without bulky frameworks (pure HTML, CSS, and Vanilla JS).

---

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env`:

```env
PORT=3000

# GitHub Personal Access Token (PAT) with 'repo' scope
GITHUB_TOKEN=your_personal_access_token_here

# Your GitHub username or organization
GITHUB_OWNER=your_github_username

# Your private repository name for storing saves
GITHUB_REPO=your_private_saves_repo
```

> **Note**: Local backups, scanning, and local restores work immediately even before setting up GitHub credentials.

### 3. Run the Application

```bash
npm start
```

Visit [http://localhost:3000](http://localhost:3000) in your web browser.

---

## Project Structure

```text
SaveSync/
│
├── package.json
├── .env.example
├── .gitignore
├── README.md
│
├── server/
│   ├── index.js          # Express REST API server & static hosting
│   ├── config.js         # Configuration & directory bootstrap
│   ├── manifest.js       # Ludusavi manifest loader & updater
│   ├── scanner.js        # Save location scanner with placeholder resolution
│   ├── backup.js         # ZIP archiver & metadata generator
│   ├── restore.js        # Safe restore engine with path traversal protection
│   ├── hash.js           # SHA-256 calculation utilities
│   ├── github.js         # GitHub REST API client
│   └── sync.js           # Conflict detection & synchronization engine
│
├── web/
│   ├── index.html        # Clean, minimal web UI
│   ├── style.css         # Dark theme CSS
│   └── app.js            # Client-side state & API communication
│
├── data/
│   ├── manifest/         # Cached Ludusavi manifest (JSON/YAML)
│   └── cache/            # Local backup archives and metadata
│
├── temp/                 # Temporary staging (cleared automatically)
└── tests/                # Automated unit and integration test suite
```

---

## Remote Storage Layout

In your private GitHub repository:

```text
private-repo/
└── saves/
    ├── elden-ring/
    │   ├── latest.zip
    │   └── meta.json
    ├── cyberpunk-2077/
    │   ├── latest.zip
    │   └── meta.json
    └── stardew-valley/
        ├── latest.zip
        └── meta.json
```

---

## REST API Summary

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/status` | System status, GitHub connection, manifest info |
| `GET` | `/api/games` | List games with local save detection status |
| `GET` | `/api/games/:id` | Detailed game info and detected files |
| `GET` | `/api/games/:id/status` | Synchronization state vs GitHub |
| `POST` | `/api/games/:id/backup` | Create local ZIP backup and SHA-256 |
| `POST` | `/api/games/:id/restore` | Restore save files (safe temp unpack) |
| `POST` | `/api/games/:id/sync` | Sync single game (handles conflicts) |
| `POST` | `/api/sync` | Batch synchronize all games |
| `POST` | `/api/manifest/update` | Update Ludusavi manifest from upstream GitHub |
| `GET` | `/api/remote/:id` | Fetch remote `meta.json` from GitHub |

---

## Running Tests

```bash
npm test
```
