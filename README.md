# Antigravity Project Snapshots & Trash

A lightweight, global status bar extension for **Google Antigravity IDE** and **Visual Studio Code**.

Adds dedicated status bar icons on the bottom bar to manage project safety checkpoints (snapshots) and deleted files (trash history) without polluting your project workspace or Git commit graph.

---

## Features

- **Bottom Status Bar Integration**:
  - `$(trash) Trash`: Quick access to deleted files history and native Windows Desktop Recycle Bin.
  - `$(history) Snapshots`: Quick access to project code checkpoints, diffing, and 1-click restore.
- **Project-Specific Scope**:
  - Dynamically detects the currently active workspace.
  - Shows only the snapshots and deleted files belonging to the open project.
- **Clean Workspace Guarantee**:
  - All snapshots and trash records are stored in central global storage (`~/.antigravity-snapshots/<project>/`).
  - Leaves zero temporary files, backups, or clutter inside your project repository.
- **Visual Contents Dashboard**:
  - Full-featured in-editor webview dashboard with real-time search, file badges, tabs, and side-by-side diffing.
- **Native Windows Recycle Bin Bridge**:
  - Connects to the Windows shell bridge so deleted files can always be restored directly from the Desktop Recycle Bin.
- **Safety First**:
  - Automatic safety checkpoints before restoring ensure you can never accidentally overwrite uncommitted work.

---

## Status Bar Controls

The extension registers two status bar items on the **bottom-left bar** (right next to errors/problems):

```text
[Antigravity Icon]   main*   (x) 0 (!) 0   [ 🗑️ Trash ]   [ 🕒 Snapshots ]
```

| Icon | Action |
| :--- | :--- |
| `$(trash)` | View files sent to Windows Recycle Bin for current project |
| `$(history)` | View snapshots list, diff versions, or restore code files |

---

## Commands

| Command | Title |
| :--- | :--- |
| `antigravity.openProjectTrash` | Antigravity: View Project Trash |
| `antigravity.openProjectSnapshots` | Antigravity: View Project Snapshots |
| `antigravity.createProjectSnapshot` | Antigravity: Create Safety Snapshot |
| `antigravity.openSnapshotsDashboard` | Antigravity: Open Visual Contents Dashboard |
| `antigravity.openWindowsRecycleBin` | Antigravity: Open Windows Desktop Recycle Bin |

---

## Installation

### From VSIX Package
1. Download `antigravity-project-snapshots-1.0.0.vsix` from Releases.
2. In Antigravity or VS Code, press `Ctrl+Shift+P` and choose **Extensions: Install from VSIX...**
3. Select the `.vsix` file.

### Manual Installation
Copy the extension folder to your extensions directory:
- `~/.antigravity-ide/extensions/antigravity.project-snapshots-1.0.0-universal/`
- Or `~/.vscode/extensions/antigravity.project-snapshots-1.0.0/`

Reload Antigravity (`Developer: Reload Window`).

---

## License

MIT License. Copyright (c) 2026.
