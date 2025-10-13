import * as vscode from "vscode";

/**
 * Função principal de ativação da extensão
 */
export async function activate(context: vscode.ExtensionContext) {
  // Comando principal para abrir o painel de deploy
  const disposable = vscode.commands.registerCommand("deploy-extension.deploy", async () => {
    const panel = vscode.window.createWebviewPanel(
      "deployPainel",
      "Deploy Automático",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    const scriptUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "main.js")
    );
    const styleUri = panel.webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, "media", "style.css")
    );

    panel.webview.html = getWebviewContent(panel.webview, scriptUri, styleUri);

    // 🔥 Listener para mensagens vindas do front-end (webview)
    panel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case "deploy":
          vscode.window.showInformationMessage("🚀 Iniciando deploy automático...");
          console.log("Mensagem recebida: deploy");

          // Exemplo: simula o processo de deploy
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: "Realizando deploy...",
              cancellable: false,
            },
            async () => {
              await new Promise((resolve) => setTimeout(resolve, 2000));
              vscode.window.showInformationMessage("✅ Deploy concluído com sucesso!");
            }
          );
          break;

        case "clearToken":
          await context.secrets.delete("vercelToken");
          vscode.window.showInformationMessage("🔑 Token da Vercel limpo com sucesso!");
          console.log("Mensagem recebida: clearToken");
          break;

        case "preview":
          vscode.window.showInformationMessage(`👀 Gerando preview: ${message.file}`);
          console.log("Mensagem recebida: preview", message.file);
          break;

        case "saveToken":
          if (message.token) {
            await context.secrets.store("vercelToken", message.token);
            vscode.window.showInformationMessage("🔐 Token da Vercel salvo com sucesso!");
            console.log("Token armazenado com segurança.");
          }
          break;

        default:
          console.warn("Mensagem desconhecida recebida do WebView:", message);
          break;
      }
    });
  });

  // Comando para limpar token via Command Palette
  const clearVercelToken = vscode.commands.registerCommand(
    "deploy-extension.clearVercelToken",
    async () => {
      await context.secrets.delete("vercelToken");
      vscode.window.showInformationMessage("🔑 Token da Vercel limpo!");
    }
  );

  context.subscriptions.push(disposable, clearVercelToken);
}

/**
 * Gera o conteúdo HTML do painel WebView
 */
function getWebviewContent(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri
): string {
  return `<!DOCTYPE html>
<html lang="pt-br">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    img-src ${webview.cspSource} https:;
    script-src ${webview.cspSource};
    style-src ${webview.cspSource} 'unsafe-inline';
  ">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Deploy Automático</title>
</head>
<body>
  <h2>🚀 Deploy Automático</h2>

  <div class="actions">
    <button id="deployBtn">Iniciar Deploy</button>
    <button id="clearTokenBtn">Limpar Token da Vercel</button>
  </div>

  <div class="tokenBox">
    <input id="tokenInput" type="password" placeholder="Insira seu token da Vercel..." />
    <button id="saveTokenBtn">Salvar Token</button>
  </div>

  <div id="previewContainer"></div>

  <script src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Função de desativação da extensão
 */
export function deactivate() {}





