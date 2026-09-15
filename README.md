# ViniPlay

<p align="center">
  <img src="https://i.imgur.com/u9Jq1qA.png" alt="ViniPlay Logo" width="200">
</p>

ViniPlay is a modern, high-performance IPTV player built for web browsers. It features a React-based frontend and an Express-based Node.js backend to securely manage users, transcode video streams via FFMPEG (with GPU support), and manage your M3U and EPG sources.

## 🚀 Como Rodar o ViniPlay (How to Run)

Com a recente transição para a arquitetura de **Monorepo** (Frontend em React/Vite + Backend em Node/Express), existem três maneiras principais de se rodar o ViniPlay:

### 1. Desenvolvimento Local (Live Reload / Debug)
Esta é a melhor forma de rodar se você for editar o código.
- **Frontend** roda na porta `5173` via Vite (com HMR - Live Reload).
- **Backend** roda na porta `8999` via TSX (compilação TypeScript on-the-fly).
- O Frontend automaticamente usa Proxy para repassar requisições `/api` para o Backend.

**Como rodar:**
1. Na raiz do projeto, instale as dependências: `npm install`
2. Rode o comando mágico que levanta o Front e Back juntos:
   ```bash
   npm run dev
   ```
3. Acesse `http://localhost:5173` no seu navegador. As alterações no código refletirão instantaneamente na tela ou reiniciarão a API.

### 2. Produção Local (PM2 / Monolito sem Docker)
Se você quer rodar localmente no seu PC, mas sem as ferramentas pesadas de live-reload, utilizando a versão de alta performance (já compilada em JavaScript puro).
- O Backend servirá a própria interface na porta `8999`.

**Como rodar:**
1. Compile o projeto inteiro: `npm run build`
2. Inicie o sistema via PM2: `npm run pm2:start`
3. Monitore em tempo real os recursos e os logs do Winston: `npm run pm2:monit`
4. Acesse `http://localhost:8999`. (Para desligar, use `npm run pm2:stop`).

### 3. Produção com Docker Compose (Recomendado para Servidores)
O método final empacota tudo (Frontend + Backend) numa imagem Ubuntu limpa já com `jellyfin-ffmpeg` (suporte a transcoding por Placas de Vídeo).

1. Crie seu `docker-compose.yml` e a pasta de volume `data`.
2. Rode o comando:
   ```bash
   docker-compose --profile container up -d --build
   ```
3. O servidor estará disponível na porta `8998`.

### 4. Desenvolvimento com Docker (hot reload)

Para desenvolver sem instalar Node.js/ffmpeg localmente, use o modo dev do
Docker Compose. Ele monta o código-fonte como volume, então alterações nos
arquivos `.ts`/`.tsx` são refletidas automaticamente (backend via `tsx
watch`, frontend via Vite HMR), sem precisar reconstruir a imagem.

```bash
npm run docker:dev
```

O backend fica em `http://localhost:8999` e o frontend (com hot reload) em
`http://localhost:5173`. Os dados persistentes ainda usam as pastas `./data`
e `./dvr` do host, como no modo produção.

Este modo usa `Dockerfile.dev`/`docker-compose.dev.yml`, separados do
`Dockerfile`/`docker-compose.yml` de produção -- nenhum dos dois modos
interfere no outro.

---

## 🏗️ Estrutura do Projeto (Monorepo)

O projeto usa **NPM Workspaces** para gerenciar os dois pacotes de forma independente:

```
/
├── frontend/                        # Frontend React + TypeScript + Vite
│   ├── src/
│   │   ├── components/              # Componentes React reutilizáveis (Players, Modals)
│   │   ├── pages/                   # Páginas da aplicação (Admin, Guide, Multiview)
│   │   ├── store/                   # Gerenciamento de Estado (Zustand)
│   │   └── api/                     # Integrações com a API do Backend
│   └── package.json                 # Dependências do Vite e React
│
├── backend/                         # Backend Node.js + Express + Zod
│   ├── src/
│   │   ├── routes/                  # REST API endpoints (Auth, Logs, Streams)
│   │   ├── services/                # Regras de Negócio (Winston Logger, Xtream, FFMPEG)
│   │   ├── db/                      # Conexões Knex e SQLite
│   │   └── index.ts                 # Ponto de entrada do Express
│   └── package.json                 # Dependências do Node
│
├── ecosystem.config.cjs             # Configuração do painel PM2 (Monitoramento)
├── Dockerfile                       # Build multi-stage otimizado
├── docker-compose.yml               # Orquestração do Container
└── package.json                     # Scripts utilitários Globais
```

---
## ⚖️ License

ViniPlay is licensed under **CC BY-NC-SA 4.0**.
