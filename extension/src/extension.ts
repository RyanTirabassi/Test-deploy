// src/extension.ts
import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

type RunResult = { ok: boolean; stdout: string; stderr: string };

function runCommand(cmd: string, cwd: string, onData?: (d: string) => void): Promise<RunResult> {
  return new Promise(resolve => {
    const p = exec(cmd, { cwd, maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) resolve({ ok: false, stdout: stdout ?? '', stderr: stderr ?? (err.message ?? '') });
      else resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
    if (p.stdout) p.stdout.on('data', d => onData?.(String(d)));
    if (p.stderr) p.stderr.on('data', d => onData?.(String(d)));
  });
}

function makeSafeName(name: string) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

const VERCEL_SECRET_KEY = 'vercelToken';

export function activate(context: vscode.ExtensionContext) {
  console.log('🚀 Deploy extension activated');

  const disposable = vscode.commands.registerCommand('deploy-extension.deploy', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.resolve(context.extensionUri.fsPath, '..');

    if (!fs.existsSync(projectRoot)) {
      vscode.window.showErrorMessage('Project root not found. Abra a pasta do projeto (não apenas a subpasta).');
      return;
    }

    const panel = vscode.window.createWebviewPanel('deployPanel', 'Deploy Automático', vscode.ViewColumn.One, {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'media'),
        vscode.Uri.joinPath(context.extensionUri, 'webview')
      ]
    });

    const scriptUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'main.js'));
    const styleUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'style.css'));

    panel.webview.html = getWebviewContent(panel.webview, scriptUri.toString(), styleUri.toString());
    vscode.window.showInformationMessage('Painel de Deploy aberto!');

    const sendLog = (t: string) => panel.webview.postMessage({ type: 'log', text: String(t) });

    async function sendStatus() {
      const res = await runCommand('git status --porcelain', projectRoot, d => sendLog(d));
      const files = (res.stdout || '')
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .map(l => (l.length > 3 ? l.slice(3).trim() : l.trim()));
      panel.webview.postMessage({ type: 'status', files });
    }

    await sendStatus();

    panel.webview.onDidReceiveMessage(async (msg: any) => {
      try {
        if (msg.type === 'requestStatus') {
          await sendStatus();
        } else if (msg.type === 'saveToken') {
          if (msg.token) {
            await context.secrets.store(VERCEL_SECRET_KEY, String(msg.token));
            panel.webview.postMessage({ type: 'tokenSaved' });
            sendLog('Token saved securely.');
          }
        } else if (msg.type === 'preview') {
          const file = String(msg.file || '');
          if (!file) {
            panel.webview.postMessage({ type: 'preview', file, text: 'No file' });
            return;
          }
          const r = await runCommand(`git diff -- "${file.replace(/"/g, '\\"')}"`, projectRoot, d => sendLog(d));
          panel.webview.postMessage({ type: 'preview', file, text: r.stdout || r.stderr });
        } else if (msg.type === 'deploy') {
          panel.webview.postMessage({ type: 'log', text: 'Starting deploy...' });
          const branchRes = await runCommand('git rev-parse --abbrev-ref HEAD', projectRoot);
          const branch = (branchRes.stdout || '').trim() || 'main';

          if (Array.isArray(msg.targets) && msg.targets.includes('github')) {
            if (msg.files && msg.files.length) {
              const quoted = msg.files.map((f: string) => `"${f.replace(/"/g, '\\"')}"`).join(' ');
              await runCommand(`git add ${quoted}`, projectRoot, d => sendLog(d));
            } else {
              await runCommand('git add .', projectRoot, d => sendLog(d));
            }
            await runCommand(`git commit -m "deploy: automatic" || true`, projectRoot, d => sendLog(d));
            const pushRes = await runCommand(`git push origin ${branch}`, projectRoot, d => sendLog(d));
            panel.webview.postMessage({ type: 'log', text: pushRes.stdout || pushRes.stderr });
            sendLog(`Git push to ${branch} finished.`);
          }

          if (Array.isArray(msg.targets) && msg.targets.includes('vercel')) {
            const build = await runCommand('npm run build', projectRoot, d => sendLog(d));
            if (!build.ok) {
              panel.webview.postMessage({ type: 'log', text: build.stderr || 'Build failed' });
              vscode.window.showErrorMessage('Build failed. Check output in panel.');
              return;
            }
            sendLog('Build finished.');

            const token = msg.token || (await context.secrets.get(VERCEL_SECRET_KEY)) || '';
            if (!token) {
              vscode.window.showErrorMessage('Vercel token not set. Save token in panel first.');
              return;
            }

            let baseName = path.basename(projectRoot);
            try {
              const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
              if (pkg && pkg.name) baseName = String(pkg.name);
            } catch { /* ignore */ }

            const safeName = makeSafeName(baseName) || 'deploy-project';
            const vercelCmd = `npx vercel --prod --token="${token}" --yes --name="${safeName}"`;

            const vercelRes = await runCommand(vercelCmd, projectRoot, d => sendLog(d));
            panel.webview.postMessage({ type: 'log', text: vercelRes.stdout || vercelRes.stderr });
            sendLog('Vercel deploy finished.');
          }

          panel.webview.postMessage({ type: 'log', text: 'Deploy finished.' });
          await sendStatus();
        }
      } catch (err: any) {
        sendLog('Exception: ' + (err?.message ?? String(err)));
        vscode.window.showErrorMessage('Error during deploy process: ' + (err?.message ?? String(err)));
      }
    });
  });

  const clearToken = vscode.commands.registerCommand('deploy-extension.clearVercelToken', async () => {
    await context.secrets.delete(VERCEL_SECRET_KEY);
    vscode.window.showInformationMessage('Vercel token removed from secure storage.');
  });

  context.subscriptions.push(disposable, clearToken);
}

export function deactivate() {
  console.log('Deploy extension deactivated');
}

function getWebviewContent(webview: vscode.Webview, scriptUri: string, styleUri: string) {
  const csp = webview.cspSource;
  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https:; style-src ${csp} 'unsafe-inline'; script-src ${csp} 'unsafe-inline' 'unsafe-eval';">
<meta name="viewport" content="width=device-width,initial-scale=1" />
<link rel="stylesheet" href="${styleUri}">
<title>Deploy Automático</title>
</head>
<body>
  <div id="root"></div>
  <script src="${scriptUri}"></script>
</body>
</html>`;
}










