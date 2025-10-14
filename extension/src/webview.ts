import * as vscode from 'vscode';

export function createWebviewPanel(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        'deployPanel',
        'Deploy Automático',
        vscode.ViewColumn.One,
        { enableScripts: true }
    );

    const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', 'main.js')
    );
    const styleUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'media', 'style.css')
    );

    panel.webview.html = getWebviewContent(styleUri, scriptUri);
    return panel;
}

function getWebviewContent(styleUri: vscode.Uri, scriptUri: vscode.Uri): string {
    return /* html */ `
    <!DOCTYPE html>
    <html lang="pt-br">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="${styleUri}">
        <title>Deploy Automático</title>
        <style>
            body {
                background-color: #1e1e1e;
                color: #fff;
                font-family: Arial, sans-serif;
                padding: 20px;
            }
            h1 {
                font-size: 20px;
                display: flex;
                align-items: center;
                gap: 8px;
                color: #fff;
            }
            label {
                display: flex;
                align-items: center;
                gap: 6px;
                margin-right: 15px;
            }
            .logo {
                width: 20px;
                height: 20px;
                object-fit: contain;
            }
            .footer {
                margin-top: 20px;
                font-size: 12px;
                color: #ccc;
            }
            .deploy-options {
                display: flex;
                align-items: center;
                margin-bottom: 15px;
            }
            button {
                background-color: #007acc;
                color: #fff;
                border: none;
                padding: 8px 14px;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                background-color: #005fa3;
            }
        </style>
    </head>
    <body>
        <h1>🚀 Deploy Automático</h1>

        <div class="deploy-options">
            <label title="Deploy via GitHub">
                <input type="checkbox" id="github">
                <img class="logo" src="https://cdn.pixabay.com/photo/2022/01/30/13/33/github-6980894_1280.png" alt="GitHub Logo">
            </label>

            <label title="Deploy via Vercel">
                <input type="checkbox" id="vercel">
                <img class="logo" src="https://s3.typoniels.de/typoniels-strapi/production/vercel_7b7d3ef99c.webp" alt="Vercel Logo">
            </label>
        </div>

        <button id="deploy">Iniciar Deploy</button>

        <div class="footer">
            Selecione onde deseja realizar o deploy e clique em "Iniciar Deploy".
        </div>

        <script src="${scriptUri}"></script>
    </body>
    </html>`;
}




