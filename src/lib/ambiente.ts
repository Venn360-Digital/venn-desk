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
        ABERTURA_RATE_LIMITER: RateLimit
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

/** O que o Workers entrega no binding de rate limit. */
export interface RateLimit {
    limit(opcoes: { key: string }): Promise<{ success: boolean }>
}
