# ViniPlay Custom Cast Receiver

Esta pasta contém o **Custom Web Receiver** para Smart TVs e aparelhos Chromecast usando o **Cast Application Framework (CAF) v1.0** do Google.

---

## 🎯 Por que usar este Custom Receiver?

1. **Fim da queda após 5 minutos**: O Default Media Receiver padrão da Google (`CC1AD845`) fecha a aplicação compulsoriamente após 5 minutos de inatividade (pausado ou aguardando mídia). Este receiver customizado eleva a tolerância para **3600 segundos (1 hora)** (`maxInactivity: 3600`).
2. **Identidade Visual ViniPlay**: Tela de splash elegante com logotipo ViniPlay, status de conexão em tempo real e animação ambiente enquanto aguarda reprodução.
3. **Resiliência de Rede**: Interceptador de carregamento com buffers configurados para evitar travamentos de fMP4 e HLS.

---

## 🚀 Como Hospedar (Opção Recomendada: GitHub Pages)

O Chromecast exige que o receiver seja servido em **HTTPS com certificado SSL público e válido** (ele rejeita certificados autoassinados da rede local). O **GitHub Pages** ou **Cloudflare Pages** são ideais, gratuitos e fornecem SSL da Google/DigiCert nativamente.

### Passo a Passo no GitHub Pages:
1. Crie um repositório público (ou use o próprio) no seu GitHub (ex.: `viniplay-cast-receiver`).
2. Suba o conteúdo desta pasta (`index.html`, `receiver.js`, `style.css` e a pasta `assets/`).
3. No repositório do GitHub, vá em:
   - **Settings** -> **Pages**
   - Em *Build and deployment*, selecione a branch `main` (ou `gh-pages`) e a pasta `/ (root)`.
   - Clique em **Save**.
4. Copie a URL gerada pelo GitHub Pages (exemplo: `https://seu-usuario.github.io/viniplay-cast-receiver/`).

---

## 🔑 Como Registrar no Google Cast Developer Console

1. Acesse o [Google Cast Developer Console](https://cast.google.com/publish).
2. Se ainda não possuir, realize o registro de desenvolvedor Google Cast (taxa única de $5 USD cobrada pelo Google).
3. Clique em **Add New Application** e escolha **Custom Receiver**.
4. Preencha as informações:
   - **Name**: `ViniPlay`
   - **URL**: Cole a URL do seu GitHub Pages criada no passo anterior (ex: `https://seu-usuario.github.io/viniplay-cast-receiver/index.html`).
   - Marque a opção de suporte a áudio/vídeo.
5. Clique em **Save**.
6. O Google gerará um **Application ID** de 8 caracteres alfanuméricos (exemplo: `E49A12B8`).

---

## ⚙️ Configurando no ViniPlay

1. Abra o ViniPlay no navegador.
2. Vá em **Configurações** -> Aba **Perfis / Streaming & Cast**.
3. No campo **Google Cast Application ID**, substitua o padrão pelo seu App ID gerado.
4. Clique em **Salvar Seleção de Perfis**.
5. Pronto! As próximas transmissões para o Chromecast carregarão automaticamente o seu Custom Receiver ViniPlay com 1 hora de tolerância a pausas!
