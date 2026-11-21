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
        /** O modelo da extração da base viva. Sonnet 5 por padrão. */
        MODELO_DO_EXTRATOR?: string
        /** O modelo de quando a tela já existia e só mudou. Haiku 4.5 por padrão. */
        MODELO_DO_EXTRATOR_INCREMENTAL?: string
        /** O modelo da biblioteca de casos. Haiku 4.5 por padrão. */
        MODELO_DO_SUGERIDOR?: string
        /**
         * `sim` liga a varredura diária que gera rascunhos de artigo a partir
         * dos chamados. DESLIGADA por padrão: é o único job que chama modelo
         * sem ninguém pedir, e um dia de US$ 229 em novembro de 2026 ensinou
         * que isso precisa de uma decisão escrita, não de um padrão.
         */
        SUGESTOES_AUTOMATICAS?: string
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
        /**
         * A fila da base viva: sincronização com o repositório e sugestões de
         * artigo. Separada da do atendimento porque um job de sincronização
         * leva minutos e nunca deve atrasar uma resposta a cliente.
         */
        CONHECIMENTO?: Fila
        /**
         * O GitHub App do Venn Desk (`Contents: read`, instalado só no
         * venn-saas). Três segredos: o ID do App, o ID da instalação e a chave
         * privada em PKCS#8. É o caminho definitivo (ADR 0011).
         */
        GITHUB_APP_ID?: string
        GITHUB_APP_INSTALACAO_ID?: string
        GITHUB_APP_CHAVE_PRIVADA?: string
        /**
         * Alternativa ao App: um token pessoal só de leitura. Serve para testar
         * antes de o App estar instalado. Com o App presente, é ignorado.
         */
        GITHUB_TOKEN_LEITURA?: string
        /** Workers AI, para o embedding da busca semântica (`bge-m3`). */
        AI?: WorkersAi
        /**
         * Chave PRIVADA (JWK, Ed25519) com que o Desk assina o token de
         * `consultar_conta` para os apps. Segredo. Ausente, a ferramenta não
         * entra no catálogo.
         */
        DESK_CHAVE_PRIVADA_SUPORTE?: string
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

/** O binding do Workers AI. Só o que usamos: `run` com um modelo de embedding. */
export interface WorkersAi {
    run(modelo: string, entrada: { text: string[]; truncate_inputs?: boolean }): Promise<{ data: number[][] }>
}

/** O que o Workers entrega no binding de rate limit. */
export interface RateLimit {
    limit(opcoes: { key: string }): Promise<{ success: boolean }>
}
