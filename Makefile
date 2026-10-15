.DEFAULT_GOAL := help
.PHONY: help dev dev-docker prod prod-build down stop logs logs-dev caddy status restart

# Colors for terminal output
CYAN   := \033[36m
GREEN  := \033[32m
YELLOW := \033[33m
BOLD   := \033[1m
RESET  := \033[0m

help: ## Exibe a lista de comandos disponíveis
	@echo ""
	@echo "$(BOLD)$(CYAN)ViniPlay - Automação de Ambientes (Dev & Prod)$(RESET)"
	@echo "--------------------------------------------------------"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-15s$(RESET) %s\n", $$1, $$2}'
	@echo ""

dev: ## Inicia ambiente DEV local no host (hot-reload) + Caddy HTTPS (Docker) para o Cast
	@echo "$(YELLOW)Iniciando Caddy (HTTPS para Cast SDK)...$(RESET)"
	@CADDY_UPSTREAM=host.docker.internal:8999 docker compose up -d caddy
	@echo "$(GREEN)Caddy ativo em https://localhost (e pelo IP local da rede).$(RESET)"
	@echo "$(YELLOW)Iniciando backend e frontend no host com hot-reload...$(RESET)"
	@npm run dev

dev-docker: down ## Inicia ambiente DEV 100% no Docker (hot-reload + Caddy)
	@echo "$(YELLOW)Iniciando ambiente de desenvolvimento no Docker...$(RESET)"
	docker compose -f docker-compose.dev.yml up --build

prod: down ## Inicia ambiente PROD no Docker (sem hot-reload, compilado + Caddy HTTPS)
	@echo "$(YELLOW)Compilando e iniciando stack de produção no Docker...$(RESET)"
	@CADDY_UPSTREAM=homeiptv:8998 docker compose up -d --build
	@echo ""
	@echo "$(GREEN)Stack de produção ativa com sucesso!$(RESET)"
	@echo "  $(BOLD)App & Cast:$(RESET) $(CYAN)https://localhost$(RESET) (ou https://<seu-ip-local>)"
	@echo "  Acompanhe os logs com: $(YELLOW)make logs$(RESET)"
	@echo "  Para parar: $(YELLOW)make down$(RESET)"
	@echo ""

prod-build: ## Compila a imagem Docker de produção sem iniciar contêineres
	@echo "$(YELLOW)Compilando imagem de produção...$(RESET)"
	docker compose build

caddy: ## Inicia apenas o proxy reverso Caddy (terminação HTTPS para o Cast)
	@echo "$(YELLOW)Iniciando Caddy...$(RESET)"
	@CADDY_UPSTREAM=host.docker.internal:8999 docker compose up -d caddy
	@echo "$(GREEN)Caddy rodando em https://localhost$(RESET)"

down: ## Para todos os contêineres do projeto (dev e prod)
	@echo "$(YELLOW)Parando contêineres...$(RESET)"
	@docker compose down 2>/dev/null || true
	@-docker compose -f docker-compose.dev.yml down 2>/dev/null || true
	@echo "$(GREEN)Todos os contêineres foram parados.$(RESET)"

stop: down ## Alias para 'make down'

logs: ## Exibe e acompanha os logs do ambiente de produção
	docker compose logs -f

logs-dev: ## Exibe e acompanha os logs do Caddy ou dev-docker
	docker compose logs -f caddy

status: ## Exibe o status de todos os contêineres
	@echo "$(CYAN)=== Contêineres de Produção / Caddy ===$(RESET)"
	@docker compose ps
	@echo ""
	@echo "$(CYAN)=== Contêineres de Desenvolvimento (Docker) ===$(RESET)"
	@-docker compose -f docker-compose.dev.yml ps 2>/dev/null || true

restart: down prod ## Reinicia a stack de produção
