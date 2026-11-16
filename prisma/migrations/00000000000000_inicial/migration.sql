-- O `CREATE SCHEMA IF NOT EXISTS "public"` que o Prisma emite foi REMOVIDO:
-- `public` sempre existe, e a instrucao exige CREATE no BANCO, privilegio que
-- a role de migracao nao tem de proposito (ela nao esta em neon_superuser).
-- Mante-la custaria um GRANT que nenhuma migracao precisa.

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "agent_role" AS ENUM ('AGENTE', 'GESTOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "agent_kind" AS ENUM ('HUMANO', 'IA');

-- CreateEnum
CREATE TYPE "ticket_status" AS ENUM ('NOVO', 'ABERTO', 'AGUARDANDO_USUARIO', 'EM_ESPERA', 'RESOLVIDO', 'FECHADO');

-- CreateEnum
CREATE TYPE "ticket_type" AS ENUM ('DUVIDA', 'INCIDENTE', 'PROBLEMA', 'SOLICITACAO');

-- CreateEnum
CREATE TYPE "ticket_priority" AS ENUM ('BAIXA', 'NORMAL', 'ALTA', 'URGENTE');

-- CreateEnum
CREATE TYPE "support_level" AS ENUM ('N1', 'N2', 'N3', 'HUMANO');

-- CreateEnum
CREATE TYPE "message_author" AS ENUM ('USUARIO', 'IA', 'HUMANO', 'SISTEMA');

-- CreateEnum
CREATE TYPE "message_visibility" AS ENUM ('PUBLICA', 'INTERNA');

-- CreateEnum
CREATE TYPE "message_origin" AS ENUM ('WIDGET', 'SLACK', 'MCP', 'CONSOLE', 'PORTAL', 'EMAIL');

-- CreateEnum
CREATE TYPE "eng_stage" AS ENUM ('TRIADO', 'ISSUE_CRIADA', 'APROVADO_PELO_GESTOR', 'EM_CORRECAO', 'PR_ABERTO', 'EM_STAGING', 'APROVADO_PARA_PRODUCAO', 'EM_PRODUCAO', 'VERIFICADO', 'RECUSADO_PELO_GESTOR');

-- CreateEnum
CREATE TYPE "eng_link_type" AS ENUM ('ISSUE', 'PR', 'RUN', 'DEPLOY');

-- CreateEnum
CREATE TYPE "approval_gate" AS ENUM ('ISSUE', 'PRODUCAO');

-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('APROVADO', 'RECUSADO', 'MAIS_INFORMACOES');

-- CreateEnum
CREATE TYPE "kb_status" AS ENUM ('RASCUNHO', 'PUBLICADO', 'ARQUIVADO');

-- CreateTable
CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "chave_publica_jwk" JSONB NOT NULL,
    "repositorio" TEXT,
    "canal_suporte" TEXT,
    "canal_engenharia" TEXT,
    "modo_sombra" BOOLEAN NOT NULL DEFAULT true,
    "tema" JSONB,
    "proximo_numero" INTEGER NOT NULL DEFAULT 1,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "plano" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "requesters" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel_no_tenant" TEXT NOT NULL DEFAULT 'member',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requesters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "slack_id" TEXT,
    "papel" "agent_role" NOT NULL DEFAULT 'AGENTE',
    "tipo" "agent_kind" NOT NULL DEFAULT 'HUMANO',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "senha_hash" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "requester_id" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "tipo" "ticket_type" NOT NULL DEFAULT 'DUVIDA',
    "prioridade" "ticket_priority" NOT NULL DEFAULT 'NORMAL',
    "status" "ticket_status" NOT NULL DEFAULT 'NOVO',
    "nivel" "support_level" NOT NULL DEFAULT 'N1',
    "assignee_id" TEXT,
    "problem_id" TEXT,
    "contexto" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "primeira_resposta_em" TIMESTAMP(3),
    "resolvido_em" TIMESTAMP(3),
    "fechado_em" TIMESTAMP(3),
    "excluido_em" TIMESTAMP(3),

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_messages" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "autor" "message_author" NOT NULL,
    "autor_id" TEXT,
    "visibilidade" "message_visibility" NOT NULL DEFAULT 'PUBLICA',
    "origem" "message_origin" NOT NULL DEFAULT 'WIDGET',
    "corpo" TEXT NOT NULL,
    "rascunho" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "message_id" TEXT,
    "chave" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "tamanho" INTEGER NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_events" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "ator" TEXT NOT NULL,
    "evento" TEXT NOT NULL,
    "antes" JSONB,
    "depois" JSONB,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slack_threads" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "thread_ts" TEXT NOT NULL,
    "canal_engenharia" TEXT,
    "thread_ts_engenharia" TEXT,

    CONSTRAINT "slack_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbound_events" (
    "id" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "recebido_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "problems" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "causa" TEXT,
    "etapa" "eng_stage" NOT NULL DEFAULT 'TRIADO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,
    "resolvido_em" TIMESTAMP(3),

    CONSTRAINT "problems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eng_links" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "tipo" "eng_link_type" NOT NULL,
    "url" TEXT NOT NULL,
    "estado" TEXT,
    "ambiente" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eng_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "problem_id" TEXT NOT NULL,
    "portao" "approval_gate" NOT NULL,
    "decisao" "approval_decision" NOT NULL,
    "aprovador_id" TEXT NOT NULL,
    "justificativa" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kb_articles" (
    "id" TEXT NOT NULL,
    "app_id" TEXT,
    "titulo" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "tags" TEXT[],
    "status" "kb_status" NOT NULL DEFAULT 'RASCUNHO',
    "embedding" vector(1536),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kb_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policies" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "prioridade" "ticket_priority" NOT NULL,
    "primeira_resposta_min" INTEGER NOT NULL,
    "proxima_resposta_min" INTEGER NOT NULL,
    "resolucao_min" INTEGER NOT NULL,
    "calendario" JSONB,

    CONSTRAINT "sla_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_timers" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "meta" TEXT NOT NULL,
    "vence_em" TIMESTAMP(3) NOT NULL,
    "pausado_em" TIMESTAMP(3),
    "violado_em" TIMESTAMP(3),
    "cumprido_em" TIMESTAMP(3),

    CONSTRAINT "sla_timers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "macros" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "definicao" JSONB NOT NULL,
    "dono_id" TEXT,

    CONSTRAINT "macros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "definicao" JSONB NOT NULL,
    "ativa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "views" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "definicao" JSONB NOT NULL,
    "dono_id" TEXT,

    CONSTRAINT "views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csat_responses" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "nota" INTEGER NOT NULL,
    "comentario" TEXT,
    "atendido_pela_ia" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csat_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_tags" (
    "ticket_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,

    CONSTRAINT "ticket_tags_pkey" PRIMARY KEY ("ticket_id","tag_id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "rotulo" TEXT NOT NULL,
    "definicao" JSONB NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_field_values" (
    "ticket_id" TEXT NOT NULL,
    "field_id" TEXT NOT NULL,
    "valor" JSONB NOT NULL,

    CONSTRAINT "custom_field_values_pkey" PRIMARY KEY ("ticket_id","field_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "apps_slug_key" ON "apps"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "apps_prefixo_key" ON "apps"("prefixo");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_app_id_external_id_key" ON "tenants"("app_id", "external_id");

-- CreateIndex
CREATE INDEX "requesters_app_id_email_idx" ON "requesters"("app_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "requesters_app_id_external_id_key" ON "requesters"("app_id", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "agents_email_key" ON "agents"("email");

-- CreateIndex
CREATE UNIQUE INDEX "agents_slack_id_key" ON "agents"("slack_id");

-- CreateIndex
CREATE INDEX "tickets_app_id_status_idx" ON "tickets"("app_id", "status");

-- CreateIndex
CREATE INDEX "tickets_app_id_tenant_id_status_idx" ON "tickets"("app_id", "tenant_id", "status");

-- CreateIndex
CREATE INDEX "tickets_app_id_requester_id_idx" ON "tickets"("app_id", "requester_id");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_app_id_numero_key" ON "tickets"("app_id", "numero");

-- CreateIndex
CREATE INDEX "ticket_messages_app_id_ticket_id_criado_em_idx" ON "ticket_messages"("app_id", "ticket_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_chave_key" ON "attachments"("chave");

-- CreateIndex
CREATE INDEX "attachments_app_id_ticket_id_idx" ON "attachments"("app_id", "ticket_id");

-- CreateIndex
CREATE INDEX "ticket_events_app_id_ticket_id_criado_em_idx" ON "ticket_events"("app_id", "ticket_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "slack_threads_ticket_id_key" ON "slack_threads"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "slack_threads_canal_thread_ts_key" ON "slack_threads"("canal", "thread_ts");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_origem_external_id_key" ON "inbound_events"("origem", "external_id");

-- CreateIndex
CREATE INDEX "problems_app_id_etapa_idx" ON "problems"("app_id", "etapa");

-- CreateIndex
CREATE INDEX "eng_links_app_id_problem_id_idx" ON "eng_links"("app_id", "problem_id");

-- CreateIndex
CREATE INDEX "approvals_app_id_problem_id_idx" ON "approvals"("app_id", "problem_id");

-- CreateIndex
CREATE INDEX "kb_articles_app_id_status_idx" ON "kb_articles"("app_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "sla_policies_app_id_prioridade_key" ON "sla_policies"("app_id", "prioridade");

-- CreateIndex
CREATE INDEX "sla_timers_app_id_vence_em_idx" ON "sla_timers"("app_id", "vence_em");

-- CreateIndex
CREATE UNIQUE INDEX "csat_responses_ticket_id_key" ON "csat_responses"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_app_id_nome_key" ON "tags"("app_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_app_id_chave_key" ON "custom_fields"("app_id", "chave");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requesters" ADD CONSTRAINT "requesters_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requesters" ADD CONSTRAINT "requesters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "requesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_messages" ADD CONSTRAINT "ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "ticket_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_events" ADD CONSTRAINT "ticket_events_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slack_threads" ADD CONSTRAINT "slack_threads_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "problems" ADD CONSTRAINT "problems_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eng_links" ADD CONSTRAINT "eng_links_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_problem_id_fkey" FOREIGN KEY ("problem_id") REFERENCES "problems"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_aprovador_id_fkey" FOREIGN KEY ("aprovador_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kb_articles" ADD CONSTRAINT "kb_articles_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_policies" ADD CONSTRAINT "sla_policies_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_timers" ADD CONSTRAINT "sla_timers_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "macros" ADD CONSTRAINT "macros_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "views" ADD CONSTRAINT "views_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "csat_responses" ADD CONSTRAINT "csat_responses_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_tags" ADD CONSTRAINT "ticket_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "custom_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

