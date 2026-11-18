import type { App, PrismaClient } from '#prisma'

import type { EscopoDoApp } from '../dados/escopo.ts'
import type { Agente } from '../auth/sessao-console.ts'
import type { IdentidadeDoSolicitante } from '../auth/token-app.ts'

/**
 * O ambiente do Hono: bindings do Worker e o que os middlewares deixam no
 * contexto da requisição.
 *
 * Nenhuma rota recebe `PrismaClient`: ela recebe `escopo`, já amarrado a um app
 * (ver `src/dados/escopo.ts`). O cliente fica aqui só porque a abertura de
 * chamado precisa abrir transação, e quem a abre é o cliente.
 */
export interface Ambiente {
    Bindings: {
        DATABASE_URL: string
        /** Segredo da sessão do Console. */
        SEGREDO_SESSAO: string
        /** Segredo dos links assinados de anexo. */
        SEGREDO_LINKS: string
        AMBIENTE: string
        ANEXOS: R2Bucket
        /** Os assets do Console (SPA do Vite). */
        ASSETS: Fetcher
        EMAIL?: SendEmail
        /** Remetente dos avisos. Subdomínio de envio, com DKIM. */
        EMAIL_REMETENTE?: string
        /** Origem para montar o link do chamado no e-mail. */
        URL_BASE?: string
        /** A página de status, que mora fora da Cloudflare (seção 7). */
        URL_STATUS?: string
        /** Origens da página de status, separadas por vírgula. Só elas no CORS. */
        ORIGENS_DO_STATUS?: string
        /** Origens dos apps que embutem o widget. Só elas no CORS de `/api/app/*`. */
        ORIGENS_DOS_APPS?: string
        /**
         * Segredo de assinatura do app do Slack. Entra por `wrangler secret
         * put`, nunca em `wrangler.jsonc`. Ausente, a ponte recusa tudo.
         */
        SLACK_SIGNING_SECRET?: string
        /** Token do bot (`xoxb-…`), para a metade que POSTA. Também segredo. */
        SLACK_BOT_TOKEN?: string
        /** Chave da API do Claude, para o agente de atendimento. Segredo. */
        ANTHROPIC_API_KEY?: string
        /** O modelo do agente. Em `vars`, para trocar sem publicar código. */
        MODELO_DO_AGENTE?: string
        /** Quanto o agente pensa: `low`, `medium`, `high`, `xhigh` ou `max`. */
        ESFORCO_DO_AGENTE?: string
        /**
         * A tarifa usada SÓ para estimar custo na trilha de auditoria. Ela não
         * decide nada: quem corta o atendimento é o teto de passos e de tokens
         * (ver `src/agente/orcamento.ts`).
         */
        TARIFA_ENTRADA_POR_MILHAO?: string
        TARIFA_SAIDA_POR_MILHAO?: string
        ABERTURA_RATE_LIMITER: RateLimit
        /** A fila do atendimento automático. Ausente em ambiente sem Queues. */
        ATENDIMENTO?: Fila
        /** Uma sala por chamado, para o tempo real (Fase 3). */
        SALAS?: DurableObjectNamespace
    }
    Variables: {
        cliente: PrismaClient
        app: App
        escopo: EscopoDoApp
        identidade: IdentidadeDoSolicitante
        solicitante: { tenantId: string; requesterId: string }
        agente: Agente
    }
}

/** O produtor da fila. Só o que usamos. */
export interface Fila {
    send(mensagem: unknown): Promise<void>
}

/** O que o Workers entrega no binding de rate limit. */
export interface RateLimit {
    limit(opcoes: { key: string }): Promise<{ success: boolean }>
}
