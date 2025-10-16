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
const GITHUB_SECRET_KEY = 'githubToken';
const GLOBAL_REPO_KEY = 'repoUrl';

export function activate(context: vscode.ExtensionContext) {
  console.log('🚀 Deploy extension activated');

  const disposable = vscode.commands.registerCommand('deploy-extension.deploy', async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    const projectRoot = workspaceFolder ? workspaceFolder.uri.fsPath : path.resolve(context.extensionUri.fsPath, '..');

    if (!fs.existsSync(projectRoot)) {
      vscode.window.showErrorMessage('Pasta do projeto não encontrada. Abra a pasta raiz do projeto.');
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
    const githubIcon = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'github.png')).toString();
    const vercelIcon = panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'vercel.png')).toString();

    panel.webview.html = getWebviewContent(panel.webview, scriptUri.toString(), styleUri.toString(), githubIcon, vercelIcon);
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

    // helper to store secret only if changed and notify properly
    async function saveSecretIfNew(secretKey: string, token: string, label: string) {
      const normalized = String(token || '').trim();
      if (!normalized) {
        vscode.window.showWarningMessage(`${label} vazio. Informe um token válido.`);
        sendLog(`${label} vazio. Nada salvo.`);
        panel.webview.postMessage({ type: 'tokenSaveResult', key: secretKey, ok: false, text: 'vazio' });
        return;
      }
      const existing = await context.secrets.get(secretKey);
      if (existing === normalized) {
        const msg = `${label} já salvo.`;
        vscode.window.showWarningMessage(msg);
        sendLog(msg);
        panel.webview.postMessage({ type: 'tokenSaveResult', key: secretKey, ok: false, text: 'duplicado' });
        return;
      }
      await context.secrets.store(secretKey, normalized);
      const msg = `${label} salvo com segurança.`;
      vscode.window.showInformationMessage(msg);
      sendLog(msg);
      panel.webview.postMessage({ type: 'tokenSaveResult', key: secretKey, ok: true, text: 'salvo' });
    }

    // helper to save repo URL in globalState
    async function saveRepoUrlIfNew(url: string) {
      const normalized = String(url || '').trim();
      if (!normalized) {
        vscode.window.showWarningMessage('Repo URL vazio. Informe uma URL válida.');
        sendLog('Repo URL vazio. Nada salvo.');
        panel.webview.postMessage({ type: 'repoSaveResult', ok: false, text: 'vazio' });
        return;
      }
      const existing = context.globalState.get<string>(GLOBAL_REPO_KEY, '');
      if (existing === normalized) {
        const msg = 'Repo URL já salvo.';
        vscode.window.showWarningMessage(msg);
        sendLog(msg);
        panel.webview.postMessage({ type: 'repoSaveResult', ok: false, text: 'duplicado' });
        return;
      }
      await context.globalState.update(GLOBAL_REPO_KEY, normalized);
      const msg = 'Repo URL salvo com segurança.';
      vscode.window.showInformationMessage(msg);
      sendLog(msg);
      panel.webview.postMessage({ type: 'repoSaveResult', ok: true, text: 'salvo' });
    }

    // helper: extract owner/repo from https://github.com/owner/repo(.git)
    function getRepoPathFromUrl(url: string | undefined) {
      if (!url) return '';
      try {
        let u = String(url).trim();
        if (u.startsWith('https://')) u = u.replace('https://', '');
        if (u.includes('@')) {
          const parts = u.split('@');
          u = parts[parts.length - 1];
        }
        const parts = u.split('/');
        const owner = parts[1] || '';
        const repo = (parts[2] || '').replace(/\.git$/, '');
        return owner && repo ? `${owner}/${repo}` : '';
      } catch {
        return '';
      }
    }

    // helper to test GitHub access via git ls-remote (uses token if provided)
    async function testGithubAccess(repoUrl: string | undefined, ghToken: string | undefined) {
      try {
        const repoPath = getRepoPathFromUrl(repoUrl);
        if (!repoPath) {
          return { ok: false, text: 'Repo URL inválida ou não informada.' };
        }
        let testUrl = repoUrl || `https://github.com/${repoPath}.git`;
        if (ghToken && testUrl.startsWith('https://')) {
          testUrl = testUrl.replace('https://', `https://${ghToken}@`);
        }
        const res = await runCommand(`git ls-remote --exit-code "${testUrl}"`, projectRoot, d => sendLog(d));
        if (res.ok) return { ok: true, text: 'Acesso ao GitHub OK (ls-remote funcionou).' };
        return { ok: false, text: 'Falha ao acessar repositório remoto: ' + (res.stderr || res.stdout) };
      } catch (err: any) {
        return { ok: false, text: 'Erro testando GitHub: ' + (err?.message ?? String(err)) };
      }
    }

    // helper to test Vercel token
    async function testVercelAccess(vercelToken: string | undefined) {
      try {
        if (!vercelToken) return { ok: false, text: 'Token Vercel não informado.' };
        const cmd = `npx vercel whoami --token="${vercelToken}"`;
        const res = await runCommand(cmd, projectRoot, d => sendLog(d));
        if (res.ok && (res.stdout || '').trim()) {
          return { ok: true, text: 'Vercel: ' + res.stdout.trim().split('\n')[0] };
        }
        return { ok: false, text: 'Falha autenticar Vercel: ' + (res.stderr || res.stdout) };
      } catch (err: any) {
        return { ok: false, text: 'Erro testando Vercel: ' + (err?.message ?? String(err)) };
      }
    }

    // Listen messages from the webview
    panel.webview.onDidReceiveMessage(async (msg: any) => {
      try {
        if (msg.type === 'requestStatus') {
          await sendStatus();
        }

        // Save GitHub token
        else if (msg.type === 'saveGithubToken') {
          await saveSecretIfNew(GITHUB_SECRET_KEY, String(msg.token || ''), 'GitHub token');
        }

        // Save Vercel token
        else if (msg.type === 'saveVercelToken') {
          await saveSecretIfNew(VERCEL_SECRET_KEY, String(msg.token || ''), 'Token do Vercel');
        }

        // Save repo URL
        else if (msg.type === 'saveRepoUrl') {
          await saveRepoUrlIfNew(String(msg.url || ''));
        }

        // Clear a saved secret (GitHub)
        else if (msg.type === 'clearGithubToken') {
          await context.secrets.delete(GITHUB_SECRET_KEY);
          const msgText = 'GitHub token removido do armazenamento seguro.';
          vscode.window.showInformationMessage(msgText);
          sendLog(msgText);
        }

        // Clear Vercel token
        else if (msg.type === 'clearVercelToken') {
          await context.secrets.delete(VERCEL_SECRET_KEY);
          const msgText = 'Token do Vercel removido do armazenamento seguro.';
          vscode.window.showInformationMessage(msgText);
          sendLog(msgText);
        }

        // Clear Repo URL
        else if (msg.type === 'clearRepoUrl') {
          await context.globalState.update(GLOBAL_REPO_KEY, '');
          const msgText = 'Repo URL removida.';
          vscode.window.showInformationMessage(msgText);
          sendLog(msgText);
        }

        // Preview diff for a file
        else if (msg.type === 'preview') {
          const file = String(msg.file || '');
          if (!file) {
            panel.webview.postMessage({ type: 'preview', file, text: 'No file' });
            return;
          }
          const r = await runCommand(`git diff -- "${file.replace(/"/g, '\\"')}"`, projectRoot, d => sendLog(d));
          panel.webview.postMessage({ type: 'preview', file, text: r.stdout || r.stderr });
        }

        // Test Deploy (checks tokens, repo accessibility, local git)
        else if (msg.type === 'testDeploy') {
          panel.webview.postMessage({ type: 'log', text: '🔎 Iniciando checagem (Testar Deploy)...' });

          const repoUrlFromField = String(msg.repoUrl || '').trim();
          const repoUrlSaved = context.globalState.get<string>(GLOBAL_REPO_KEY, '').trim();
          const repoUrlToUse = repoUrlFromField || repoUrlSaved || '';

          const ghTokenFromField = String(msg.ghToken || '').trim();
          const ghTokenSaved = await context.secrets.get(GITHUB_SECRET_KEY);
          const ghTokenToUse = ghTokenFromField || ghTokenSaved || '';

          const vercelTokenFromField = String(msg.vercelToken || '').trim();
          const vercelTokenSaved = await context.secrets.get(VERCEL_SECRET_KEY);
          const vercelTokenToUse = vercelTokenFromField || vercelTokenSaved || '';

          // local git check
          const gitVersion = await runCommand('git --version', projectRoot, d => sendLog(d));
          const hasGit = gitVersion.ok;
          panel.webview.postMessage({ type: 'log', text: `git --version: ${gitVersion.stdout || gitVersion.stderr}` });

          let localRepo = false;
          if (hasGit) {
            const st = await runCommand('git rev-parse --is-inside-work-tree', projectRoot);
            localRepo = st.ok && (st.stdout || '').toString().trim() === 'true';
          }
          panel.webview.postMessage({ type: 'log', text: `Repositório local: ${localRepo ? 'Sim' : 'Não'}` });

          // GitHub test
          let ghResult = { ok: false, text: 'Não verificado' };
          if (!repoUrlToUse) {
            ghResult = { ok: false, text: 'Repo URL não informada (salve a Repo URL ou preencha o campo).' };
          } else {
            sendLog('🔎 Testando acesso GitHub (ls-remote)...');
            ghResult = await testGithubAccess(repoUrlToUse, ghTokenToUse);
          }
          panel.webview.postMessage({ type: 'log', text: `GitHub: ${ghResult.text}` });

          // Vercel test
          let vercelResult = { ok: false, text: 'Não verificado' };
          if (!vercelTokenToUse) {
            vercelResult = { ok: false, text: 'Token Vercel não disponível.' };
          } else {
            sendLog('🔎 Testando autenticação Vercel (npx vercel whoami)...');
            vercelResult = await testVercelAccess(vercelTokenToUse);
          }
          panel.webview.postMessage({ type: 'log', text: `Vercel: ${vercelResult.text}` });

          const summary = {
            gitInstalled: hasGit,
            localRepo,
            github: ghResult,
            vercel: vercelResult,
            repoUrl: repoUrlToUse,
            ghTokenProvided: !!ghTokenToUse,
            vercelTokenProvided: !!vercelTokenToUse
          };

          panel.webview.postMessage({ type: 'testResult', summary });
          panel.webview.postMessage({ type: 'log', text: '🔎 Teste finalizado.' });
        }

        // Deploy: respects targets (github/vercel), repo URL and saved tokens
        else if (msg.type === 'deploy') {
          panel.webview.postMessage({ type: 'log', text: 'Iniciando deploy...' });
          const githubSelected = !!msg.github;
          const vercelSelected = !!msg.vercel;
          const repoUrlFromField = String(msg.repoUrl || '').trim();
          const repoUrlSaved = context.globalState.get<string>(GLOBAL_REPO_KEY, '').trim();

          let repoUrlToUse = repoUrlSaved;
          if (repoUrlFromField) {
            repoUrlToUse = repoUrlFromField;
            await saveRepoUrlIfNew(repoUrlFromField);
          }

          const gitExists = fs.existsSync(path.join(projectRoot, '.git'));
          if (!gitExists && repoUrlToUse) {
            sendLog('Nenhum repositório Git local encontrado. Inicializando repositório...');
            await runCommand('git init', projectRoot, d => sendLog(d));
            await runCommand('git add .', projectRoot, d => sendLog(d));
            await runCommand('git commit -m "Initial commit (automatic by Deploy Extension)" || true', projectRoot, d => sendLog(d));
            let remoteUrl = repoUrlToUse;
            if (githubSelected) {
              const ghToken = (await context.secrets.get(GITHUB_SECRET_KEY)) || '';
              if (ghToken && remoteUrl.startsWith('https://')) {
                remoteUrl = remoteUrl.replace('https://', `https://${ghToken}@`);
              }
            }
            await runCommand(`git remote add origin "${remoteUrl}"`, projectRoot, d => sendLog(d));
            await runCommand('git branch -M main', projectRoot, d => sendLog(d));
            const firstPush = await runCommand('git push -u origin main', projectRoot, d => sendLog(d));
            sendLog(firstPush.stdout || firstPush.stderr);
          }

          const branchRes = await runCommand('git rev-parse --abbrev-ref HEAD', projectRoot);
          const branch = (branchRes.stdout || '').trim() || 'main';

          if (githubSelected) {
            sendLog('🚀 Fazendo push para o GitHub...');
            if (msg.files && msg.files.length) {
              const quoted = msg.files.map((f: string) => `"${f.replace(/"/g, '\\"')}"`).join(' ');
              await runCommand(`git add ${quoted}`, projectRoot, d => sendLog(d));
            } else {
              await runCommand('git add .', projectRoot, d => sendLog(d));
            }
            await runCommand(`git commit -m "${(msg.message || 'deploy: automatic').replace(/"/g, '\\"')}" || true`, projectRoot, d => sendLog(d));

            const ghToken = (await context.secrets.get(GITHUB_SECRET_KEY)) || '';
            let pushCmd = `git push origin ${branch}`;
            if (ghToken) {
              const remoteUrl = (context.globalState.get<string>(GLOBAL_REPO_KEY, '') || '').trim();
              if (remoteUrl && remoteUrl.startsWith('https://')) {
                const tokenRemote = remoteUrl.replace('https://', `https://${ghToken}@`);
                await runCommand(`git remote set-url origin "${tokenRemote}"`, projectRoot, d => sendLog(d));
                pushCmd = `git push origin ${branch}`;
              } else {
                const repoPath = getRepoPathFromUrl(repoUrlToUse) || '';
                if (repoPath) pushCmd = `git push https://${ghToken}@github.com/${repoPath} ${branch}`.trim();
              }
            }
            const pushRes = await runCommand(pushCmd, projectRoot, d => sendLog(d));
            sendLog(pushRes.stdout || pushRes.stderr);
          }

          if (vercelSelected) {
            sendLog('⚙️ Executando build e deploy no Vercel...');
            const build = await runCommand('npm run build', projectRoot, d => sendLog(d));
            if (!build.ok) {
              vscode.window.showErrorMessage('Erro no build. Verifique o painel.');
              sendLog('Build falhou: ' + (build.stderr || ''));
              return;
            }

            const token = msg.token || (await context.secrets.get(VERCEL_SECRET_KEY)) || '';
            if (!token) {
              vscode.window.showErrorMessage('Token do Vercel não configurado.');
              sendLog('Token do Vercel não configurado.');
              return;
            }

            let baseName = path.basename(projectRoot);
            try {
              const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
              if (pkg && pkg.name) baseName = String(pkg.name);
            } catch {}

            const safeName = makeSafeName(baseName) || 'deploy-project';
            const vercelCmd = `npx vercel --prod --token="${token}" --yes --name="${safeName}"`;
            const vercelRes = await runCommand(vercelCmd, projectRoot, d => sendLog(d));
            sendLog(vercelRes.stdout || vercelRes.stderr);
          }

          sendLog('✅ Deploy finalizado.');
          await sendStatus();
        }
      } catch (err: any) {
        sendLog('Erro: ' + (err?.message ?? String(err)));
        vscode.window.showErrorMessage('Erro no processo de deploy: ' + (err?.message ?? String(err)));
      }
    });
  });

  const clearToken = vscode.commands.registerCommand('deploy-extension.clearVercelToken', async () => {
    await context.secrets.delete(VERCEL_SECRET_KEY);
    vscode.window.showInformationMessage('Token do Vercel removido do armazenamento seguro.');
  });

  context.subscriptions.push(disposable, clearToken);
}

/** Helper: extract owner/repo from a typical https://github.com/owner/repo.git URL */
function getRepoPathFromUrl(url: string | undefined) {
  if (!url) return '';
  try {
    let u = String(url).trim();
    if (u.startsWith('https://')) u = u.replace('https://', '');
    if (u.includes('@')) {
      const parts = u.split('@');
      u = parts[parts.length - 1];
    }
    const parts = u.split('/');
    const owner = parts[1] || '';
    const repo = parts[2] ? parts[2].replace(/\.git$/, '') : '';
    return owner && repo ? `${owner}/${repo}` : '';
  } catch {
    return '';
  }
}

export function deactivate() {
  console.log('Deploy extension deactivated');
}

function getWebviewContent(webview: vscode.Webview, scriptUri: string, styleUri: string, githubIcon: string, vercelIcon: string) {
  const csp = webview.cspSource;
  return `<!doctype html>
<html lang="pt-br">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} https: data:; style-src ${csp} 'unsafe-inline'; script-src ${csp} 'unsafe-inline' 'unsafe-eval';">
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Deploy Automático</title>
  <style>
    body { background-color: #1e1e1e; color: #fff; font-family: "Segoe UI", sans-serif; display: flex; flex-direction: column; gap: 1rem; padding: 14px; }
    h2 { color: #e0e0e0; margin: 0 0 6px 0; font-size: 16px; }
    .deploy-top { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }

    .card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: #2b2b2b;
      border: 1px solid #3a3a3a;
      border-radius: 12px;
      padding: 10px 12px;
      width: 280px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.5);
      transition: all 0.18s ease;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .card-left { display: flex; align-items: center; gap: 10px; z-index: 1; }
    .card-left img { width: 40px; height: 40px; object-fit: contain; border-radius: 6px; padding: 4px; background: transparent; }
    .card-text strong { font-size: 14px; font-weight: 600; color: #e6e6e6; }
    .card-text .muted { color: #9aa0a6; font-size: 12px; margin-top: 2px; }

    /* invisible full-size checkbox that captures clicks */
    .card input[type="checkbox"] {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 0;
      opacity: 0;
      cursor: pointer;
      z-index: 2;
    }

    /* visual small checkbox (fake) */
    .fake-checkbox {
      width: 20px;
      height: 20px;
      border: 2px solid #555;
      border-radius: 6px;
      background: transparent;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      color: white;
      z-index: 3;
      pointer-events: none; /* deixa o input receber o clique */
      transition: background .12s ease, border-color .12s ease;
    }

    /* PSEUDO-ELEMENT: desenha o ✔ dentro do fake-checkbox quando o card está ativo */
    .fake-checkbox::after {
      content: "";
      display: inline-block;
      font-size: 12px;
      line-height: 1;
      transform: scale(1);
      opacity: 0;
      transition: opacity .12s ease, transform .12s ease;
    }

    .card.active { box-shadow: 0 0 10px #0078ff44; border-color: #0078ff; background: #2f3338; transform: translateY(-1px); }
    .card.active .fake-checkbox { background: #0078ff; border-color: #0078ff; }
    /* mostra o check quando ativo */
    .card.active .fake-checkbox::after {
      content: "✔";
      color: white;
      opacity: 1;
      transform: scale(1);
    }

    .card:hover { transform: translateY(-2px); background: #333; }

    /* painel */
    .section { margin-top:8px; padding:10px; background:#222; border-radius:8px; }
    label.small { font-size:12px; color:#ccc; display:block; margin-bottom:6px; }
    input[type="text"], input[type="password"], input[type="url"] { width:100%; padding:8px; border-radius:6px; border:1px solid #333; background:#2a2a2a; color:#ddd; }
    button { background:#0b6ddf; color:#fff; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; margin-right:8px; }
    button.secondary { background:#444; color:#fff; }
    #files { max-height:120px; overflow:auto; background:#0c0c0c; padding:8px; border-radius:6px; color:#ddd; }
    #logs { white-space:pre-line; background:#070707; padding:8px; border-radius:6px; height:140px; overflow:auto; color:#9bd; font-size:12px; margin-top:8px; }

    @media (max-width:520px) { .card { width: 100%; } .deploy-top { gap:8px; } }
  </style>
</head>
<body>
  <h2>🚀 Deploy Automático</h2>

  <div class="deploy-top">
    <label class="card" title="Deploy via Vercel">
      <input id="optVercel" type="checkbox" checked>
      <div class="card-left">
        <img src="${vercelIcon}" alt="Vercel">
        <div class="card-text">
          <strong>Vercel</strong>
          <div class="muted">Deploy & Preview</div>
        </div>
      </div>
      <span class="fake-checkbox" aria-hidden="true"></span>
    </label>

    <label class="card" title="Deploy via GitHub">
      <input id="optGithub" type="checkbox" checked>
      <div class="card-left">
        <img src="${githubIcon}" alt="GitHub">
        <div class="card-text">
          <strong>GitHub</strong>
          <div class="muted">Push & Actions</div>
        </div>
      </div>
      <span class="fake-checkbox" aria-hidden="true"></span>
    </label>
  </div>

  <!-- restante do HTML (tokens, repo, buttons, logs, scripts) igual ao que você já tinha -->
  <!-- ... (mantive o mesmo JS que atualiza .active baseado no input.checked) ... -->

  <div class="section">
    <label class="small">GitHub Token</label>
    <input id="githubToken" type="text" placeholder="github_pat_..." />
    <div style="margin-top:8px;">
      <button id="saveGithubBtn">Salve GitHub</button>
      <button id="clearGithubBtn" class="secondary">Limpar</button>
    </div>
  </div>

  <div class="section">
    <label class="small">Vercel Token</label>
    <input id="vercelToken" type="text" placeholder="vercel_..." />
    <div style="margin-top:8px;">
      <button id="saveVercelBtn">Salve Vercel</button>
      <button id="clearVercelBtn" class="secondary">Limpar</button>
    </div>
  </div>

  <div class="section">
    <label class="small">Repo URL (ex: https://github.com/user/repo.git)</label>
    <input id="repoUrl" type="url" placeholder="https://github.com/owner/repo.git" />
    <div style="margin-top:8px;">
      <button id="saveRepoUrlBtn">Salve URL</button>
      <button id="clearRepoUrlBtn" class="secondary">Limpar</button>
    </div>
  </div>

  <div class="section">
    <label class="small">Mensagem de commit (opcional)</label>
    <input id="commitMessage" type="text" placeholder="Descrição do deploy (opcional)" />
    <div style="margin-top:8px; display:flex; gap:8px;">
      <button id="refresh">Atualizar arquivos</button>
      <button id="deploy">Iniciar Deploy</button>
      <button id="testDeploy" class="secondary">Testar Deploy</button>
    </div>
  </div>

  <h3 style="color:#eee; margin:8px 0 4px 0; font-size:13px;">Arquivos modificados</h3>
  <div id="files"></div>

  <h3 style="color:#eee; margin-top:8px; font-size:13px;">Logs</h3>
  <div id="logs"></div>

  <script>
    const vscode = acquireVsCodeApi();
    const logs = document.getElementById('logs');
    const addLog = (t) => { logs.innerText += "\\n" + t; logs.scrollTop = logs.scrollHeight; };

    document.querySelectorAll('.card').forEach(card => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      if (!checkbox) return;
      const applyState = () => card.classList.toggle('active', checkbox.checked);
      checkbox.addEventListener('change', applyState);
      applyState();
    });

    // restante dos handlers permanece igual ao seu código anterior...
    document.getElementById('saveGithubBtn').addEventListener('click', () => {
      const token = (document.getElementById('githubToken')).value.trim();
      vscode.postMessage({ type: 'saveGithubToken', token });
      addLog('Solicitado salvar token GitHub (local).');
    });
    document.getElementById('saveVercelBtn').addEventListener('click', () => {
      const token = (document.getElementById('vercelToken')).value.trim();
      vscode.postMessage({ type: 'saveVercelToken', token });
      addLog('Solicitado salvar token Vercel (local).');
    });
    document.getElementById('saveRepoUrlBtn').addEventListener('click', () => {
      const url = (document.getElementById('repoUrl')).value.trim();
      vscode.postMessage({ type: 'saveRepoUrl', url });
      addLog('Solicitado salvar Repo URL (local).');
    });
    document.getElementById('clearGithubBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'clearGithubToken' });
      addLog('Solicitado limpar GitHub token.');
    });
    document.getElementById('clearVercelBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'clearVercelToken' });
      addLog('Solicitado limpar Vercel token.');
    });
    document.getElementById('clearRepoUrlBtn').addEventListener('click', () => {
      vscode.postMessage({ type: 'clearRepoUrl' });
      addLog('Solicitado limpar Repo URL.');
    });
    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'requestStatus' });
      addLog('Solicitado refresh de arquivos.');
    });
    document.getElementById('deploy').addEventListener('click', () => {
      const repoUrl = (document.getElementById('repoUrl')).value.trim();
      const message = (document.getElementById('commitMessage')).value.trim();
      const github = document.getElementById('optGithub').checked;
      const vercel = document.getElementById('optVercel').checked;
      const token = (document.getElementById('vercelToken')).value.trim();
      vscode.postMessage({ type: 'deploy', repoUrl, message, github, vercel, token });
      addLog('Solicitado iniciar deploy (git + vercel).');
    });
    document.getElementById('testDeploy').addEventListener('click', () => {
      const repoUrl = (document.getElementById('repoUrl')).value.trim();
      const ghToken = (document.getElementById('githubToken')).value.trim();
      const vercelToken = (document.getElementById('vercelToken')).value.trim();
      vscode.postMessage({ type: 'testDeploy', repoUrl, ghToken, vercelToken });
      addLog('Solicitado Testar Deploy (validação de tokens e acessos).');
    });

    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'log') addLog(msg.text);
      else if (msg.type === 'status') {
        const filesDiv = document.getElementById('files');
        filesDiv.innerHTML = msg.files.map(f => '<div><input type="checkbox" checked> ' + f + '</div>').join('');
      } else if (msg.type === 'preview') addLog('--- Preview: ' + msg.file + ' ---\\n' + (msg.text || ''));
      else if (msg.type === 'testResult') {
        addLog('\\n=== Resultado do Teste ===');
        const s = msg.summary;
        addLog('git instalado: ' + (s.gitInstalled ? 'Sim' : 'Não'));
        addLog('repo local: ' + (s.localRepo ? 'Sim' : 'Não'));
        addLog('Repo URL: ' + (s.repoUrl || '(vazio)'));
        addLog('GitHub ok: ' + (s.github?.ok ? 'Sim' : 'Não - ' + (s.github?.text || '')) );
        addLog('Vercel ok: ' + (s.vercel?.ok ? 'Sim' : 'Não - ' + (s.vercel?.text || '')) );
        addLog('===========================');
      } else if (msg.type === 'tokenSaveResult') addLog('Token save result: ' + (msg.ok ? 'OK' : msg.text));
      else if (msg.type === 'repoSaveResult') addLog('Repo save result: ' + (msg.ok ? 'OK' : msg.text));
    });

    vscode.postMessage({ type: 'requestStatus' });
  </script>
</body>
</html>`;
}

























