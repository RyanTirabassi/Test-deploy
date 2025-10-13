import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as path from 'path';

export function createWebviewPanel(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    'deployPanel',
    'Deploy Automático',
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const scriptUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'main.js');
  const styleUri = vscode.Uri.joinPath(context.extensionUri, 'media', 'style.css');

  panel.webview.html = getWebviewContent(panel.webview, scriptUri, styleUri);

  // Recebe mensagens da interface
  panel.webview.onDidReceiveMessage(async (msg) => {
    if (msg.command === 'deploy') {
      const { target, repo, description } = msg;

      vscode.window.showInformationMessage(`🚀 Fazendo deploy em: ${target}`);
      vscode.window.showInformationMessage(`📁 Repositório: ${repo}`);
      vscode.window.showInformationMessage(`📝 Descrição: ${description}`);

      let command = '';
      if (target === 'github') command = 'git push origin main';
      else if (target === 'vercel') command = 'npx vercel --prod';
      else command = 'git push origin main && npx vercel --prod';

      exec(command, (error, stdout, stderr) => {
        if (error) {
          panel.webview.postMessage({ type: 'error', text: error.message });
          return;
        }
        panel.webview.postMessage({ type: 'success', text: stdout });
      });
    }
  });
}

function getWebviewContent(webview: vscode.Webview, scriptUri: vscode.Uri, styleUri: vscode.Uri): string {
  const scriptSrc = webview.asWebviewUri(scriptUri);
  const styleSrc = webview.asWebviewUri(styleUri);

  return /*html*/`
  <!DOCTYPE html>
  <html lang="pt-br">
  <head>
    <meta charset="UTF-8" />
    <link rel="stylesheet" href="${styleSrc}" />
    <title>Deploy Automático</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="${scriptSrc}"></script>
  </body>
  </html>
  `;
}