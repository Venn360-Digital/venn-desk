import { Hono } from 'hono'

import { conferir } from './lib/assinatura.ts'
import { ErroDeDominio } from './lib/erros.ts'
import type { Ambiente } from './lib/ambiente.ts'
import { appPorSlug } from './dados/apps.ts'
import { criarCliente, descartarCliente } from './dados/cliente.ts'
import { escopoDoApp } from './dados/escopo.ts'
import { rotasDoSolicitante } from './rotas/solicitante.ts'
import { rotasInternas } from './rotas/interna.ts'

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

export default app
