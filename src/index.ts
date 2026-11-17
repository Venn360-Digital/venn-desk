import { Hono } from 'hono'

import { conferir } from './lib/assinatura.ts'
import { ErroDeDominio } from './lib/erros.ts'
import type { Ambiente } from './lib/ambiente.ts'
import { appPorSlug } from './dados/apps.ts'
import { criarCliente, descartarCliente } from './dados/cliente.ts'
import { escopoDoApp } from './dados/escopo.ts'
import { rotasDoSolicitante } from './rotas/solicitante.ts'
import { rotasInternas } from './rotas/interna.ts'
import { rotasDeStatus } from './rotas/status.ts'
import { rotasDoPortal } from './rotas/portal.ts'
import { rotasDoSlack } from './rotas/slack.ts'
import { verificarSaude } from './saude/verificar.ts'
import { vigiarPrazos } from './sla/vigiar.ts'
import type { CaixaDeSaida } from './correio/enviar.ts'

/**
 * O Worker do Venn Desk: API do solicitante, API interna, entrega de anexo e os
 * assets do Console.
 *
 * O MCP (`/mcp`) e a ponte do Slack (`/slack/*`) entram nas Fases 4 e 3, no
 * mesmo Worker — é o que a seção 3 descreve.
 */
const app = new Hono<Ambiente>()

/**
 * O tratamento de erro é central de propósito: nenhuma rota escreve mensagem de
 * erro à mão, e nada que não seja `ErroDeDominio` vaza texto para o cliente — a
 * seção 10 proíbe expor detalhe interno de código ou de infraestrutura.
 */
app.onError((erro, c) => {
    if (erro instanceof ErroDeDominio) {
        return c.json({ erro: { codigo: erro.codigo, mensagem: erro.message } }, erro.status as 400)
    }

    console.error('[venn-desk] erro não tratado:', erro)

    return c.json(
        { erro: { codigo: 'erro_interno', mensagem: 'Algo deu errado. Tente de novo.' } },
        500
    )
})

app.get('/api/saude', (c) => c.json({ ok: true, ambiente: c.env.AMBIENTE }))

app.route('/', rotasDoSolicitante)
app.route('/', rotasInternas)
app.route('/', rotasDeStatus)
app.route('/', rotasDoPortal)
app.route('/', rotasDoSlack)

/**
 * A entrega do anexo. Só o link assinado abre: a chave carrega o app e a
 * assinatura cobre os dois (ver `src/lib/assinatura.ts`). O bucket é privado e
 * nenhuma credencial de S3 existe.
 */
app.get('/arquivos/:chave{.+}', async (c) => {
    const chave = decodeURIComponent(c.req.param('chave'))
    const token = c.req.query('t') ?? ''

    /// O app sai da própria chave: o caminho do objeto começa pelo slug.
    const slug = chave.split('/')[0] ?? ''
    const cliente = criarCliente(c.env.DATABASE_URL)

    try {
        const app = await appPorSlug(cliente, slug)
        if (app === null) return c.notFound()

        const valido = await conferir(c.env.SEGREDO_LINKS, { appId: app.id, chave, token })
        if (!valido) return c.notFound()

        const anexo = await escopoDoApp(cliente, app.id).anexos.porChave(chave)
        if (anexo === null) return c.notFound()

        const objeto = await c.env.ANEXOS.get(chave)
        if (objeto === null) return c.notFound()

        return new Response(objeto.body, {
            headers: {
                'Content-Type': anexo.tipo,
                'Content-Disposition': `inline; filename="${encodeURIComponent(anexo.nome)}"`,
                /// Privado e por pouco tempo: o link já expira, e o cache
                /// compartilhado não deve guardar anexo de cliente.
                'Cache-Control': 'private, max-age=60',
            },
        })
    } finally {
        await descartarCliente(cliente)
    }
})

/** Fora da API, é o Console: uma SPA servida dos assets (ADR 0008). */
app.get('*', (c) => c.env.ASSETS.fetch(c.req.raw))

/**
 * O Worker exporta `fetch` E `scheduled` — o segundo é o Cron Trigger da
 * verificação de saúde (seção 7), declarado em `wrangler.jsonc`.
 *
 * O cliente do Prisma é criado e descartado DENTRO do handler, como nas rotas:
 * uma invocação agendada que termina sem `$disconnect()` deixa conexão
 * pendurada no Neon, e esta roda 1.440 vezes por dia.
 */
export default {
    fetch(requisicao: Request, env: Ambiente['Bindings'], ctx: ExecutionContext) {
        return app.fetch(requisicao, env, ctx)
    },

    async scheduled(_controlador: unknown, env: Ambiente['Bindings'], _ctx: unknown) {
        const cliente = criarCliente(env.DATABASE_URL)

        try {
            /**
             * Saúde e prazos no mesmo minuto, em paralelo: são leituras
             * independentes, e encadeá-las faria a segunda esperar a primeira
             * sondar três apps pela rede.
             */
            const [vereditos, estouros] = await Promise.all([
                verificarSaude(cliente, {
                    caixa: env.EMAIL as unknown as CaixaDeSaida | undefined,
                    remetente: {
                        email: env.EMAIL_REMETENTE ?? 'suporte@mail.venn360.com',
                        nome: 'Venn Desk · Alertas',
                    },
                    urlStatus: env.URL_STATUS,
                }),
                vigiarPrazos(cliente),
            ])

            /// Só o que mudou vira log. 1.440 execuções por dia escrevendo
            /// "tudo bem" é o jeito de ninguém encontrar o dia em que não
            /// estava.
            const mudaram = vereditos.filter((v) => v.mudanca !== null)
            if (mudaram.length > 0) {
                console.log('[saude]', JSON.stringify(mudaram))
            }
            if (estouros.length > 0) {
                console.log('[sla]', JSON.stringify(estouros))
            }
        } finally {
            await descartarCliente(cliente)
        }
    },
}

/// O Durable Object precisa ser exportado pelo módulo de entrada do Worker.
export { SalaDoChamado } from './tempo-real/sala.ts'
