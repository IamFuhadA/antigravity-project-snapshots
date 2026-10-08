const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, execSync } = require('child_process');

let trashStatusBarItem = null;
let snapshotsStatusBarItem = null;
let currentWebviewPanel = null;

function getActiveProject() {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const root = folders[0].uri.fsPath;
  const name = path.basename(root);
  return { root, name };
}

function getProjectSnapshotsDirs(project) {
  const dirs = [];
  if (project) {
    const local = path.join(project.root, '.snapshots');
    if (fs.existsSync(local)) dirs.push(local);
    const globalDir = path.join(os.homedir(), '.antigravity-snapshots', project.name);
    if (fs.existsSync(globalDir)) dirs.push(globalDir);
  }
  return dirs;
}

function getSnapshots(project) {
  if (!project) return [];
  const dirs = getProjectSnapshotsDirs(project);
  const globalDir = path.join(os.homedir(), '.antigravity-snapshots', project.name);
  if (!dirs.includes(globalDir) && fs.existsSync(globalDir)) dirs.push(globalDir);

  const results = [];
  const seenIds = new Set();

  dirs.forEach(d => {
    try {
      const entries = fs.readdirSync(d);
      entries.forEach(sub => {
        const subPath = path.join(d, sub);
        try {
          if (fs.statSync(subPath).isDirectory()) {
            const metaPath = path.join(subPath, 'meta.json');
            if (fs.existsSync(metaPath)) {
              const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              if (!seenIds.has(meta.id || sub)) {
                seenIds.add(meta.id || sub);
                meta.snapshotDir = subPath;
                results.push(meta);
              }
            }
          }
        } catch (e) {}
      });
    } catch (e) {}
  });

  results.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return results;
}

function getTrashHistory(project) {
  if (!project) return [];
  const files = [
    path.join(project.root, '.trash_history.json'),
    path.join(os.homedir(), '.antigravity-snapshots', project.name, 'trash_history.json'),
    path.join(os.homedir(), '.antigravity-snapshots', project.name, '.trash_history.json')
  ];
  let items = [];
  const seenIds = new Set();
  files.forEach(f => {
    if (fs.existsSync(f)) {
      try {
        const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
        if (Array.isArray(raw)) {
          raw.forEach(item => {
            const key = item.id || (item.timestamp + (item.files || []).join(','));
            if (!seenIds.has(key)) {
              seenIds.add(key);
              items.push(item);
            }
          });
        }
      } catch (e) {}
    }
  });
  return items;
}

function updateStatusBar() {
  const project = getActiveProject();

  if (!project) {
    if (trashStatusBarItem) {
      trashStatusBarItem.text = '$(trash)';
      trashStatusBarItem.tooltip = 'Project Trash: No active workspace';
      trashStatusBarItem.show();
    }
    if (snapshotsStatusBarItem) {
      snapshotsStatusBarItem.text = '$(history)';
      snapshotsStatusBarItem.tooltip = 'Project Snapshots: No active workspace';
      snapshotsStatusBarItem.show();
    }
    return;
  }

  const snapshots = getSnapshots(project);
  const trash = getTrashHistory(project);

  if (trashStatusBarItem) {
    trashStatusBarItem.text = trash.length > 0 ? ('$(trash) ' + trash.length) : '$(trash)';
    trashStatusBarItem.tooltip = 'Project Trash (' + project.name + ')\n' +
      trash.length + ' item(s) in trash history.\nClick to view contents or open Windows Desktop Recycle Bin.';
    trashStatusBarItem.show();
  }

  if (snapshotsStatusBarItem) {
    snapshotsStatusBarItem.text = snapshots.length > 0 ? ('$(history) ' + snapshots.length) : '$(history)';
    snapshotsStatusBarItem.tooltip = 'Project Snapshots (' + project.name + ')\n' +
      snapshots.length + ' snapshot(s) available.\nClick to view saved contents, take snapshot, or restore.';
    snapshotsStatusBarItem.show();
  }
}

async function openProjectTrash() {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showInformationMessage('No active project opened in Antigravity.');
    return;
  }

  const trash = getTrashHistory(project);

  const quickPickItems = [
    {
      label: '$(trash) Open Windows Desktop Recycle Bin',
      description: 'Open the native Windows Recycle Bin folder',
      action: 'recycle_bin'
    },
    {
      label: '$(refresh) Refresh Trash List',
      description: 'Reload deleted items list',
      action: 'refresh'
    },
    {
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    }
  ];

  if (trash.length === 0) {
    quickPickItems.push({
      label: '$(info) Trash history is clean for ' + project.name,
      description: 'No files have been moved to the trash for this project.',
      action: 'none'
    });
  } else {
    trash.forEach(t => {
      const filesCount = (t.files || []).length;
      quickPickItems.push({
        label: '$(trash) ' + (t.timestamp || '') + ' - ' + (t.note || 'Deleted'),
        description: filesCount + ' file(s)',
        detail: (t.files || []).join(', '),
        action: 'view_item',
        item: t
      });
    });
  }

  const selected = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: 'Trash history for project: ' + project.name
  });

  if (!selected) return;

  if (selected.action === 'recycle_bin') {
    openWindowsRecycleBin();
  } else if (selected.action === 'refresh') {
    updateStatusBar();
    vscode.window.showInformationMessage('Trash history refreshed.');
  } else if (selected.action === 'view_item' && selected.item) {
    vscode.window.showInformationMessage(
      'Files sent to Recycle Bin: ' + selected.item.files.join(', ') + '. Open Desktop Recycle Bin to restore.',
      'Open Recycle Bin'
    ).then(res => {
      if (res === 'Open Recycle Bin') openWindowsRecycleBin();
    });
  }
}

async function openProjectSnapshots() {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showInformationMessage('No active project opened in Antigravity.');
    return;
  }

  const snapshots = getSnapshots(project);

  const quickPickItems = [
    {
      label: '$(camera) Create Safety Snapshot Now',
      description: 'Save checkpoint of modified project files',
      action: 'create'
    },
    {
      label: '$(layout) Open Visual Contents Dashboard',
      description: 'View full cards, file lists, and 1-click restore',
      action: 'dashboard'
    },
    {
      label: '$(refresh) Refresh Snapshots',
      description: 'Reload list of saved checkpoints',
      action: 'refresh'
    },
    {
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    }
  ];

  if (snapshots.length === 0) {
    quickPickItems.push({
      label: '$(info) No Snapshots Yet for ' + project.name,
      description: 'Click "Create Safety Snapshot Now" above to take one!',
      action: 'none'
    });
  } else {
    snapshots.forEach(s => {
      const fileCount = (s.files || []).length;
      const sizeStr = s.size_kb ? ('(' + s.size_kb + ' KB)') : '';
      quickPickItems.push({
        label: '$(history) ' + (s.timestamp || '') + ' - ' + (s.description || s.id),
        description: fileCount + ' files ' + sizeStr,
        detail: (s.files || []).slice(0, 5).join(', ') + (fileCount > 5 ? '...' : ''),
        action: 'view_snapshot',
        snapshot: s
      });
    });
  }

  const selected = await vscode.window.showQuickPick(quickPickItems, {
    placeHolder: 'Snapshots for project: ' + project.name
  });

  if (!selected) return;

  if (selected.action === 'create') {
    createSnapshot();
  } else if (selected.action === 'dashboard') {
    openSnapshotsDashboard();
  } else if (selected.action === 'refresh') {
    updateStatusBar();
    vscode.window.showInformationMessage('Snapshots refreshed.');
  } else if (selected.action === 'view_snapshot' && selected.snapshot) {
    showSnapshotDetails(project, selected.snapshot);
  }
}

async function showSnapshotDetails(project, snapshot) {
  const fileItems = [
    {
      label: '$(discard) Restore All Files in this Snapshot',
      description: 'Overwrites project versions with ' + snapshot.files.length + ' snapshot files',
      action: 'restore_all'
    },
    {
      label: '',
      kind: vscode.QuickPickItemKind.Separator
    }
  ];

  (snapshot.files || []).forEach(f => {
    const snapFile = path.join(snapshot.snapshotDir, f);
    const projFile = path.join(project.root, f);
    const exists = fs.existsSync(projFile);

    fileItems.push({
      label: '$(file-code) ' + f,
      description: exists ? 'Present in project' : 'Missing from project',
      action: 'file',
      relPath: f,
      snapFile,
      projFile
    });
  });

  const choice = await vscode.window.showQuickPick(fileItems, {
    placeHolder: 'Snapshot: ' + snapshot.description + ' (' + snapshot.files.length + ' files)'
  });

  if (!choice) return;

  if (choice.action === 'restore_all') {
    restoreAllInSnapshot(project, snapshot);
  } else if (choice.action === 'file') {
    const fileAction = await vscode.window.showQuickPick([
      { label: '$(diff) Compare with Current Version', action: 'diff' },
      { label: '$(discard) Restore this File', action: 'restore' }
    ], {
      placeHolder: 'File: ' + choice.relPath
    });

    if (!fileAction) return;
    if (fileAction.action === 'diff') {
      if (fs.existsSync(choice.snapFile) && fs.existsSync(choice.projFile)) {
        vscode.commands.executeCommand(
          'vscode.diff',
          vscode.Uri.file(choice.snapFile),
          vscode.Uri.file(choice.projFile),
          choice.relPath + ' (Snapshot) ↔ Current'
        );
      } else {
        vscode.window.showWarningMessage('Cannot diff: one of the files does not exist.');
      }
    } else if (fileAction.action === 'restore') {
      restoreSingleFile(project, choice.snapFile, choice.projFile, choice.relPath);
    }
  }
}

function restoreAllInSnapshot(project, snapshot) {
  vscode.window.showWarningMessage(
    'Restore all ' + snapshot.files.length + ' files from snapshot "' + snapshot.description + '"? Current versions will be updated.',
    { modal: true },
    'Restore'
  ).then(answer => {
    if (answer === 'Restore') {
      let count = 0;
      (snapshot.files || []).forEach(f => {
        const src = path.join(snapshot.snapshotDir, f);
        const dst = path.join(project.root, f);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dst), { recursive: true });
          fs.copyFileSync(src, dst);
          count++;
        }
      });
      vscode.window.showInformationMessage('Restored ' + count + ' file(s) from snapshot "' + snapshot.description + '".');
      updateStatusBar();
      if (currentWebviewPanel) sendWebviewData(currentWebviewPanel);
    }
  });
}

function restoreSingleFile(project, src, dst, relPath) {
  try {
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      vscode.window.showInformationMessage('Restored file: ' + relPath);
      if (currentWebviewPanel) sendWebviewData(currentWebviewPanel);
    }
  } catch (err) {
    vscode.window.showErrorMessage('Failed restoring ' + relPath + ': ' + err.message);
  }
}

async function createSnapshot() {
  const project = getActiveProject();
  if (!project) return;

  const defaultLabel = 'Snapshot - ' + new Date().toLocaleTimeString();
  const label = await vscode.window.showInputBox({
    prompt: 'Enter a label for this safety snapshot:',
    value: defaultLabel
  });

  if (!label) return;

  try {
    let modFiles = [];
    try {
      const gitOut = execSync('git status --porcelain', { cwd: project.root, encoding: 'utf8' });
      const lines = gitOut.trim().split('\n');
      lines.forEach(l => {
        if (!l) return;
        let p = l.slice(3).trim().replace(/"/g, '');
        if (p.includes(' -> ')) p = p.split(' -> ')[1];
        if (fs.existsSync(path.join(project.root, p)) && fs.statSync(path.join(project.root, p)).isFile()) {
          modFiles.push(p);
        }
      });
    } catch (e) {}

    if (modFiles.length === 0) {
      const exts = ['.php', '.js', '.css', '.html', '.json', '.sql'];
      function scanDir(dir, prefix) {
        const list = fs.readdirSync(dir);
        list.forEach(item => {
          if (item === '.git' || item === 'node_modules' || item === '.snapshots' || item === 'vendor') return;
          const full = path.join(dir, item);
          const rel = prefix ? (prefix + '/' + item) : item;
          if (fs.statSync(full).isDirectory()) {
            if (rel.split('/').length < 2) scanDir(full, rel);
          } else if (exts.includes(path.extname(item).toLowerCase())) {
            modFiles.push(rel);
          }
        });
      }
      try { scanDir(project.root, ''); } catch (e) {}
    }

    if (modFiles.length === 0) {
      vscode.window.showWarningMessage('No project code files found to snapshot.');
      return;
    }

    // Always save in global central store to keep workspace 100% clean
    const targetBaseDir = path.join(os.homedir(), '.antigravity-snapshots', project.name);
    fs.mkdirSync(targetBaseDir, { recursive: true });

    const now = new Date();
    const tsFolder = now.getFullYear() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') + '_' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    
    const cleanLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    const folderName = tsFolder + '_' + cleanLabel;
    const destDir = path.join(targetBaseDir, folderName);
    fs.mkdirSync(destDir, { recursive: true });

    let totalBytes = 0;
    const copied = [];
    modFiles.forEach(rel => {
      const src = path.join(project.root, rel);
      if (fs.existsSync(src) && fs.statSync(src).isFile()) {
        const dst = path.join(destDir, rel);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
        copied.push(rel);
        totalBytes += fs.statSync(src).size;
      }
    });

    const meta = {
      id: folderName,
      timestamp: now.toISOString().replace('T', ' ').substring(0, 19),
      description: label,
      files: copied,
      size_kb: Math.round((totalBytes / 1024) * 10) / 10
    };

    fs.writeFileSync(path.join(destDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

    vscode.window.showInformationMessage('Saved snapshot "' + label + '" (' + copied.length + ' files) for ' + project.name + '.');
    updateStatusBar();
    if (currentWebviewPanel) sendWebviewData(currentWebviewPanel);
  } catch (err) {
    vscode.window.showErrorMessage('Snapshot error: ' + err.message);
  }
}

function openWindowsRecycleBin() {
  exec('explorer.exe shell:RecycleBinFolder', (err) => {
    if (err) vscode.window.showErrorMessage('Unable to open Windows Recycle Bin: ' + err.message);
  });
}

function openSnapshotsDashboard() {
  const project = getActiveProject();
  if (!project) {
    vscode.window.showInformationMessage('No active project opened in Antigravity.');
    return;
  }

  if (currentWebviewPanel) {
    currentWebviewPanel.reveal(vscode.ViewColumn.One);
    sendWebviewData(currentWebviewPanel);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'antigravityProjectSnapshots',
    'Snapshots & Trash: ' + project.name,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true
    }
  );

  currentWebviewPanel = panel;
  panel.onDidDispose(() => { currentWebviewPanel = null; });

  panel.webview.html = getWebviewHtml(project);

  panel.webview.onDidReceiveMessage(message => {
    if (message.command === 'refresh') {
      sendWebviewData(panel);
    } else if (message.command === 'createSnapshot') {
      createSnapshot();
    } else if (message.command === 'openRecycleBin') {
      openWindowsRecycleBin();
    } else if (message.command === 'restoreSnapshot') {
      const snapshots = getSnapshots(project);
      const s = snapshots.find(x => x.id === message.id);
      if (s) restoreAllInSnapshot(project, s);
    } else if (message.command === 'restoreFile') {
      const snapshots = getSnapshots(project);
      const s = snapshots.find(x => x.id === message.id);
      if (s) {
        const src = path.join(s.snapshotDir, message.file);
        const dst = path.join(project.root, message.file);
        restoreSingleFile(project, src, dst, message.file);
      }
    } else if (message.command === 'diffFile') {
      const snapshots = getSnapshots(project);
      const s = snapshots.find(x => x.id === message.id);
      if (s) {
        const src = path.join(s.snapshotDir, message.file);
        const dst = path.join(project.root, message.file);
        if (fs.existsSync(src) && fs.existsSync(dst)) {
          vscode.commands.executeCommand(
            'vscode.diff',
            vscode.Uri.file(src),
            vscode.Uri.file(dst),
            message.file + ' (Snapshot) ↔ Current'
          );
        }
      }
    }
  });

  sendWebviewData(panel);
}

function sendWebviewData(panel) {
  const project = getActiveProject();
  if (!project) return;
  const snapshots = getSnapshots(project);
  const trash = getTrashHistory(project);

  snapshots.forEach(s => {
    s.files_detail = (s.files || []).map(f => {
      const projPath = path.join(project.root, f);
      return {
        path: f,
        exists_in_project: fs.existsSync(projPath),
        extension: path.extname(f).replace('.', '').toLowerCase()
      };
    });
  });

  trash.forEach(t => {
    t.files_detail = (t.files || []).map(f => {
      const projPath = path.join(project.root, f);
      return {
        path: f,
        exists_in_project: fs.existsSync(projPath),
        extension: path.extname(f).replace('.', '').toLowerCase()
      };
    });
  });

  panel.webview.postMessage({
    command: 'setData',
    project: project.name,
    snapshots: snapshots,
    trash: trash
  });
}

function getWebviewHtml(project) {
  return '<!DOCTYPE html>' +
'<html lang="en">' +
'<head>' +
'  <meta charset="UTF-8">' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">' +
'  <title>Snapshots & Trash - ' + project.name + '</title>' +
'  <style>' +
'    :root {' +
'      --bg-dark: #0f1216;' +
'      --card-bg: #161b22;' +
'      --card-head: #1c2128;' +
'      --border: #30363d;' +
'      --text: #e6edf3;' +
'      --text-muted: #8b949e;' +
'      --accent-red: #f85149;' +
'      --accent-blue: #58a6ff;' +
'      --accent-green: #3fb950;' +
'    }' +
'    body {' +
'      margin: 0;' +
'      padding: 24px;' +
'      background: var(--bg-dark);' +
'      color: var(--text);' +
'      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;' +
'    }' +
'    .header {' +
'      display: flex;' +
'      align-items: center;' +
'      justify-content: space-between;' +
'      border-bottom: 1px solid var(--border);' +
'      padding-bottom: 16px;' +
'      margin-bottom: 20px;' +
'    }' +
'    .title-area h1 {' +
'      margin: 0 0 4px 0;' +
'      font-size: 22px;' +
'      font-weight: 700;' +
'      display: flex;' +
'      align-items: center;' +
'      gap: 10px;' +
'    }' +
'    .title-area p {' +
'      margin: 0;' +
'      color: var(--text-muted);' +
'      font-size: 13px;' +
'    }' +
'    .btn-group {' +
'      display: flex;' +
'      gap: 8px;' +
'    }' +
'    button {' +
'      background: #21262d;' +
'      border: 1px solid var(--border);' +
'      color: var(--text);' +
'      padding: 6px 14px;' +
'      border-radius: 6px;' +
'      font-size: 12.5px;' +
'      font-weight: 600;' +
'      cursor: pointer;' +
'      display: inline-flex;' +
'      align-items: center;' +
'      gap: 6px;' +
'      transition: all 0.15s ease;' +
'    }' +
'    button:hover {' +
'      background: #30363d;' +
'      border-color: #8b949e;' +
'    }' +
'    button.primary {' +
'      background: #238636;' +
'      border-color: #2ea043;' +
'      color: #fff;' +
'    }' +
'    button.primary:hover {' +
'      background: #2ea043;' +
'    }' +
'    .toolbar {' +
'      display: flex;' +
'      justify-content: space-between;' +
'      align-items: center;' +
'      margin-bottom: 18px;' +
'      gap: 12px;' +
'      flex-wrap: wrap;' +
'    }' +
'    .search-box input {' +
'      background: #0d1117;' +
'      border: 1px solid var(--border);' +
'      color: var(--text);' +
'      padding: 7px 12px;' +
'      border-radius: 6px;' +
'      font-size: 13px;' +
'      width: 280px;' +
'      outline: none;' +
'    }' +
'    .search-box input:focus {' +
'      border-color: var(--accent-blue);' +
'    }' +
'    .tabs {' +
'      display: flex;' +
'      gap: 6px;' +
'    }' +
'    .tab {' +
'      background: #21262d;' +
'      border: 1px solid var(--border);' +
'      color: var(--text-muted);' +
'      padding: 5px 12px;' +
'      border-radius: 6px;' +
'      cursor: pointer;' +
'      font-size: 12px;' +
'      font-weight: 600;' +
'    }' +
'    .tab.active {' +
'      background: var(--accent-blue);' +
'      border-color: var(--accent-blue);' +
'      color: #ffffff;' +
'    }' +
'    .card {' +
'      background: var(--card-bg);' +
'      border: 1px solid var(--border);' +
'      border-radius: 8px;' +
'      margin-bottom: 16px;' +
'      overflow: hidden;' +
'    }' +
'    .card-head {' +
'      display: flex;' +
'      justify-content: space-between;' +
'      align-items: center;' +
'      padding: 10px 16px;' +
'      background: var(--card-head);' +
'      border-bottom: 1px solid var(--border);' +
'      font-size: 13px;' +
'    }' +
'    .badge {' +
'      font-size: 11px;' +
'      padding: 2px 8px;' +
'      border-radius: 4px;' +
'      font-weight: 700;' +
'      text-transform: uppercase;' +
'      letter-spacing: 0.5px;' +
'    }' +
'    .badge.snap {' +
'      background: rgba(88, 166, 255, 0.15);' +
'      color: var(--accent-blue);' +
'    }' +
'    .badge.trash {' +
'      background: rgba(248, 81, 73, 0.15);' +
'      color: var(--accent-red);' +
'    }' +
'    .card-body {' +
'      padding: 8px 16px;' +
'    }' +
'    .file-row {' +
'      display: flex;' +
'      justify-content: space-between;' +
'      align-items: center;' +
'      padding: 6px 0;' +
'      border-bottom: 1px solid rgba(255,255,255,0.05);' +
'      font-size: 12.5px;' +
'    }' +
'    .file-row:last-child { border-bottom: none; }' +
'    .file-path {' +
'      font-family: monospace;' +
'      color: #c9d1d9;' +
'    }' +
'    .file-actions {' +
'      display: flex;' +
'      gap: 6px;' +
'    }' +
'    .card-foot {' +
'      padding: 8px 16px;' +
'      background: #12161c;' +
'      border-top: 1px solid var(--border);' +
'      display: flex;' +
'      justify-content: space-between;' +
'      align-items: center;' +
'      font-size: 12px;' +
'      color: var(--text-muted);' +
'    }' +
'    .empty-state {' +
'      text-align: center;' +
'      padding: 60px 20px;' +
'      color: var(--text-muted);' +
'    }' +
'  </style>' +
'</head>' +
'<body>' +
'  <div class="header">' +
'    <div class="title-area">' +
'      <h1><span>&#128392;</span> Project Snapshots &amp; Trash</h1>' +
'      <p>Opened Workspace: <strong>' + project.name + '</strong></p>' +
'    </div>' +
'    <div class="btn-group">' +
'      <button class="primary" onclick="createSnapshot()">+ Take Snapshot</button>' +
'      <button onclick="openRecycleBin()">&#9851; Windows Recycle Bin</button>' +
'      <button onclick="refresh()">&#8635; Refresh</button>' +
'    </div>' +
'  </div>' +
'  <div class="toolbar">' +
'    <div class="search-box">' +
'      <input type="text" id="searchInput" placeholder="Filter contents by file name..." oninput="render()">' +
'    </div>' +
'    <div class="tabs">' +
'      <div class="tab active" id="tabAll" onclick="setTab(\'all\')">All Contents (<span id="countAll">0</span>)</div>' +
'      <div class="tab" id="tabSnaps" onclick="setTab(\'snaps\')">Snapshots (<span id="countSnaps">0</span>)</div>' +
'      <div class="tab" id="tabTrash" onclick="setTab(\'trash\')">Recycle Bin (<span id="countTrash">0</span>)</div>' +
'    </div>' +
'  </div>' +
'  <div id="contentList"></div>' +
'  <script>' +
'    const vscode = acquireVsCodeApi();' +
'    let currentData = { snapshots: [], trash: [] };' +
'    let currentTab = "all";' +
'    window.addEventListener("message", event => {' +
'      const message = event.data;' +
'      if (message.command === "setData") {' +
'        currentData = message;' +
'        render();' +
'      }' +
'    });' +
'    function setTab(tab) {' +
'      currentTab = tab;' +
'      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));' +
'      if (tab === "all") document.getElementById("tabAll").classList.add("active");' +
'      if (tab === "snaps") document.getElementById("tabSnaps").classList.add("active");' +
'      if (tab === "trash") document.getElementById("tabTrash").classList.add("active");' +
'      render();' +
'    }' +
'    function render() {' +
'      const container = document.getElementById("contentList");' +
'      const search = (document.getElementById("searchInput").value || "").toLowerCase().trim();' +
'      const snaps = currentData.snapshots || [];' +
'      const trash = currentData.trash || [];' +
'      document.getElementById("countAll").innerText = snaps.length + trash.length;' +
'      document.getElementById("countSnaps").innerText = snaps.length;' +
'      document.getElementById("countTrash").innerText = trash.length;' +
'      let items = [];' +
'      if (currentTab === "all" || currentTab === "snaps") {' +
'        snaps.forEach(s => items.push({ type: "snap", data: s, time: s.timestamp }));' +
'      }' +
'      if (currentTab === "all" || currentTab === "trash") {' +
'        trash.forEach(t => items.push({ type: "trash", data: t, time: t.timestamp }));' +
'      }' +
'      items.sort((a, b) => (b.time || "").localeCompare(a.time || ""));' +
'      if (search) {' +
'        items = items.filter(it => {' +
'          const files = it.data.files || [];' +
'          const desc = (it.data.description || it.data.note || "").toLowerCase();' +
'          return desc.includes(search) || files.some(f => f.toLowerCase().includes(search));' +
'        });' +
'      }' +
'      if (items.length === 0) {' +
'        container.innerHTML = "<div class=\\"empty-state\\"><h3>No items found</h3><p>Take a snapshot to start tracking safe checkpoints.</p></div>";' +
'        return;' +
'      }' +
'      let html = "";' +
'      items.forEach(it => {' +
'        if (it.type === "snap") {' +
'          const s = it.data;' +
'          let fileRows = (s.files_detail || []).map(f => {' +
'            return "<div class=\\"file-row\\">" +' +
'              "<span class=\\"file-path\\">" + f.path + "</span>" +' +
'              "<div class=\\"file-actions\\">" +' +
'                "<button onclick=\\"diffFile(\'" + s.id + "\', \'" + f.path + "\')\\">Diff</button>" +' +
'                "<button onclick=\\"restoreFile(\'" + s.id + "\', \'" + f.path + "\')\\">Restore</button>" +' +
'              "</div>" +' +
'            "</div>";' +
'          }).join("");' +
'          html += "<div class=\\"card\\">" +' +
'            "<div class=\\"card-head\\">" +' +
'              "<div><span class=\\"badge snap\\">Snapshot</span><strong style=\\"margin-left: 8px;\\">" + (s.description || s.id) + "</strong></div>" +' +
'              "<div>" + s.timestamp + (s.size_kb ? " (" + s.size_kb + " KB)" : "") + "</div>" +' +
'            "</div>" +' +
'            "<div class=\\"card-body\\">" + fileRows + "</div>" +' +
'            "<div class=\\"card-foot\\">" +' +
'              "<span>" + s.files.length + " file(s) saved</span>" +' +
'              "<button onclick=\\"restoreSnapshot(\'" + s.id + "\')\\">&#8634; Restore All Files</button>" +' +
'            "</div>" +' +
'          "</div>";' +
'        } else {' +
'          const t = it.data;' +
'          let fileRows = (t.files_detail || []).map(f => {' +
'            return "<div class=\\"file-row\\">" +' +
'              "<span class=\\"file-path\\">" + f.path + "</span>" +' +
'              "<span style=\\"color: var(--accent-red); font-size: 11px;\\">In Windows Recycle Bin</span>" +' +
'            "</div>";' +
'          }).join("");' +
'          html += "<div class=\\"card\\">" +' +
'            "<div class=\\"card-head\\">" +' +
'              "<div><span class=\\"badge trash\\">Recycle Bin</span><strong style=\\"margin-left: 8px;\\">" + (t.note || "Sent to Recycle Bin") + "</strong></div>" +' +
'              "<div>" + t.timestamp + "</div>" +' +
'            "</div>" +' +
'            "<div class=\\"card-body\\">" + fileRows + "</div>" +' +
'            "<div class=\\"card-foot\\">" +' +
'              "<span>Preserved in Windows Desktop Recycle Bin</span>" +' +
'              "<button onclick=\\"openRecycleBin()\\">Open Desktop Recycle Bin</button>" +' +
'            "</div>" +' +
'          "</div>";' +
'        }' +
'      });' +
'      container.innerHTML = html;' +
'    }' +
'    function refresh() { vscode.postMessage({ command: "refresh" }); }' +
'    function createSnapshot() { vscode.postMessage({ command: "createSnapshot" }); }' +
'    function openRecycleBin() { vscode.postMessage({ command: "openRecycleBin" }); }' +
'    function restoreSnapshot(id) { vscode.postMessage({ command: "restoreSnapshot", id: id }); }' +
'    function restoreFile(id, file) { vscode.postMessage({ command: "restoreFile", id: id, file: file }); }' +
'    function diffFile(id, file) { vscode.postMessage({ command: "diffFile", id: id, file: file }); }' +
'  </script>' +
'</body>' +
'</html>';
}

function activate(context) {
  trashStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 45);
  trashStatusBarItem.command = 'antigravity.openProjectTrash';
  context.subscriptions.push(trashStatusBarItem);

  snapshotsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 44);
  snapshotsStatusBarItem.command = 'antigravity.openProjectSnapshots';
  context.subscriptions.push(snapshotsStatusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('antigravity.openProjectTrash', openProjectTrash),
    vscode.commands.registerCommand('antigravity.openProjectSnapshots', openProjectSnapshots),
    vscode.commands.registerCommand('antigravity.createProjectSnapshot', createSnapshot),
    vscode.commands.registerCommand('antigravity.openSnapshotsDashboard', openSnapshotsDashboard),
    vscode.commands.registerCommand('antigravity.openWindowsRecycleBin', openWindowsRecycleBin)
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => updateStatusBar()),
    vscode.window.onDidChangeActiveTextEditor(() => updateStatusBar())
  );

  updateStatusBar();
}

function deactivate() {
  if (trashStatusBarItem) trashStatusBarItem.dispose();
  if (snapshotsStatusBarItem) snapshotsStatusBarItem.dispose();
}

module.exports = { activate, deactivate };
