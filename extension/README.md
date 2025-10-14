# 🚀 Deploy Automático — Extensão VS Code  
**Autor:** Ryan Tirabassi  
**Disciplinas:** Front End, Back End, DevOps e Estruturas de Dados  

---

## 🧠 Sobre o Projeto
O **Deploy Automático** é uma extensão para o **Visual Studio Code** que permite realizar **commits, push para o GitHub e deploys no Vercel** diretamente do editor.  
O objetivo é simplificar o processo de publicação de aplicações web, unificando Git, Build e Deploy em uma única interface.

Desenvolvido como projeto integrador das disciplinas **Front End**, **Back End**, **DevOps** e **Estruturas de Dados**.

---

## ⚙️ Funcionalidades
- 📁 Exibe os arquivos modificados do repositório (`git status`)  
- 👀 Permite visualizar o diff de cada arquivo antes do commit  
- 🧩 Realiza `git add`, `git commit` e `git push` diretamente  
- ⚡ Executa `npm run build` e `npx vercel --prod` para deploy automatizado  
- 🔒 Armazena o **token da Vercel** de forma segura usando `context.secrets`  
- 💬 Interface amigável integrada ao VS Code

---

## 🧰 Requisitos
- **Git** instalado e configurado (`git config --global user.name/email`)  
- **Node.js** e **npm**  
- **Vercel CLI** (opcional — `npx vercel` funciona sem instalar globalmente)  
- Repositório Git configurado com remote no **GitHub**

---

## ▶️ Como Usar em Desenvolvimento
1. Clone este repositório e abra-o no **VS Code**.  
2. Compile a extensão:  
   ```bash
   npm run compile