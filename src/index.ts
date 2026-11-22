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
import { rotasDoGitHub } from './rotas/github.ts'
import { rotasDoMcp } from './rotas/mcp.ts'
import { verificarSaude } from './saude/verificar.ts'
import { vigiarPrazos, vigiarRiscos } from './sla/vigiar.ts'
import { consumirAtendimentos, type LoteDaFila } from './agente/fila.ts'
import { consumirConhecimento } from './conhecimento/fila.ts'
import { leitorGitHub } from './conhecimento/github.ts'
import { credencialDoAmbiente } from './conhecimento/github-app.ts'
import { vigiarConhecimento } from './conhecimento/sincronizar.ts'
import { varrerCandidatosASugestao } from './conhecimento/varrer.ts'
import { alertarNoSlack, alertasDaRodada } from './slack/alertar.ts'
import { numerosDosChamados } from './dados/chamados.ts'
import { nivelJaAvisado, registrarAvisoDeCusto, totalDesde } from './dados/gastos.ts'
import { comecoDoDia, conferirCustoDoDia } from './dominio/teto-de-custo.ts'
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
app.route('/', rotasDoGitHub)
app.route('/', rotasDoMcp)

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

    /**
     * O consumidor da fila do atendimento automático.
     *
     * Um chamado por invocação (`max_batch_size: 1` em `wrangler.jsonc`): cada
     * atendimento é inteiro, com teto próprio, e juntar dois faria o segundo
     * herdar o tempo gasto pelo primeiro.
     */
    async queue(lote: LoteDaFila, env: Ambiente['Bindings']) {
        /// Um consumidor por Worker; o nome da fila diz de quem é o lote. A da
        /// base viva começa por `venn-desk-conhecimento` nos dois ambientes.
        if (lote.queue.startsWith('venn-desk-conhecimento')) {
            await consumirConhecimento(lote, env)
            return
        }
        await consumirAtendimentos(lote, env)
    },

    async scheduled(controlador: { scheduledTime?: number }, env: Ambiente['Bindings'], _ctx: unknown) {
        const cliente = criarCliente(env.DATABASE_URL)
        const agora = new Date(controlador.scheduledTime ?? Date.now())

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

            /**
             * O aviso de RISCO vem depois da violação, e não junto.
             *
             * Um relógio que acabou de ser marcado como violado não deve
             * também gerar aviso de risco no mesmo minuto — seriam duas linhas
             * sobre o mesmo prazo, uma dizendo "falta pouco" e outra "passou".
             */
            const riscos = await vigiarRiscos(cliente, { agora })

            /// Os números dos chamados citados, num ida-e-volta só: o alerta
            /// sem número obrigaria quem está de plantão a procurar qual era.
            const numeros = await numerosDosChamados(cliente, [
                ...estouros.map((e) => e.ticketId),
                ...riscos.map((r) => r.ticketId),
            ])

            /// Só o que mudou vira log. 1.440 execuções por dia escrevendo
            /// "tudo bem" é o jeito de ninguém encontrar o dia em que não
            /// estava.
            /**
             * O canal de alertas recebe o MESMO filtro do log: só o que mudou.
             * Em `waitUntil` não dá (o cron não tem contexto de requisição),
             * mas a postagem é rápida e um Slack lento não pode atrasar a
             * sondagem do minuto seguinte — por isso ela vem depois de tudo e
             * nunca lança.
             */
            const paraAlertar = alertasDaRodada({
                saude: vereditos,
                prazos: estouros.map((e) => ({ ...e, meta: String(e.meta) })),
                riscos: riscos.map((r) => ({ ...r, meta: String(r.meta) })),
                numeroDoChamado: (id) => {
                    const c = numeros.get(id)
                    return c === undefined ? undefined : `${c.prefixo}-${c.numero}`
                },
                urlBase: env.URL_BASE,
            })
            if (paraAlertar.length > 0) {
                await alertarNoSlack(env, paraAlertar).catch((erro: unknown) =>
                    console.error('[slack] alertas não postados:', erro)
                )
            }

            const mudaram = vereditos.filter((v) => v.mudanca !== null)
            if (mudaram.length > 0) {
                console.log('[saude]', JSON.stringify(mudaram))
            }
            if (estouros.length > 0) {
                console.log('[sla]', JSON.stringify(estouros))
            }

            /**
             * A base viva, a cada cinco minutos: um pedido ao GitHub por
             * repositório (com ETag, que não conta no limite) e, se `main`
             * andou, uma sincronização por app na fila. Não há segundo cron —
             * o de minuto já existe, e o resto é olhar o relógio.
             */
            const credencial = credencialDoAmbiente(env)
            if (agora.getUTCMinutes() % 5 === 0 && credencial !== undefined) {
                const acoes = await vigiarConhecimento(cliente, {
                    leitor: leitorGitHub(credencial),
                    fila: env.CONHECIMENTO,
                    agora,
                })
                const relevantes = acoes.filter((a) => a.acao !== 'em_dia' && a.acao !== 'aguardando_intervalo')
                if (relevantes.length > 0) console.log('[conhecimento]', JSON.stringify(relevantes))
            }

            /**
             * O cão de guarda de CUSTO, a cada cinco minutos.
             *
             * Não a cada minuto: a soma varre o dia inteiro de gastos, e ler
             * isso 1.440 vezes por dia para avisar duas é desperdício. Cinco
             * minutos é mais rápido do que qualquer reação humana ao alerta.
             *
             * O nível já avisado mora no PRÓPRIO alerta do dia: a consulta
             * conta quantas vezes cada nível foi registrado hoje, e assim o
             * aviso não se repete sem precisar de uma coluna de estado que
             * discordaria da realidade depois de um deploy.
             */
            if (agora.getUTCMinutes() % 5 === 0) {
                try {
                    const desde = comecoDoDia(agora)
                    const gastoUsd = await totalDesde(cliente, desde)
                    const jaAvisado = await nivelJaAvisado(cliente, desde)
                    const veredito = conferirCustoDoDia({
                        gastoUsd,
                        ...(env.TETO_DIARIO_DE_IA_USD === undefined
                            ? {}
                            : { tetoUsd: Number(env.TETO_DIARIO_DE_IA_USD) }),
                        jaAvisado,
                    })

                    /// `resumo` só é preenchido quando o nível subiu, e nível
                    /// que sobe nunca é `normal` — o tipo não sabe disso, e a
                    /// guarda explícita é mais honesta que uma asserção.
                    if (veredito.resumo !== '' && veredito.nivel !== 'normal') {
                        await registrarAvisoDeCusto(cliente, veredito.nivel, gastoUsd)
                        await alertarNoSlack(env, [
                            {
                                gravidade: veredito.nivel === 'estouro' ? 'caiu' : 'falha',
                                app: 'plataforma',
                                resumo: veredito.resumo,
                            },
                        ])
                        console.log('[custo]', JSON.stringify({ nivel: veredito.nivel, gastoUsd }))
                    }
                } catch (erro) {
                    console.error('[custo] cão de guarda falhou:', erro)
                }
            }

            /**
             * A biblioteca de casos, uma vez por dia, às 4h UTC.
             *
             * Hora fixa e não "a cada N minutos" porque a varredura olha os
             * últimos trinta dias: rodá-la duas vezes no mesmo dia enfileiraria
             * os mesmos chamados. O horário é o de menos chamado aberto, para a
             * fila do atendimento não disputar com a da base.
             */
            /**
             * Desligada por padrão, e por um motivo caro: em 20/11/2026 as
             * rodadas da bateria somaram US$ 229 num dia porque nada avisava
             * que a conta estava subindo. Um job que chama modelo sozinho todo
             * dia só liga quando alguém escreve `SUGESTOES_AUTOMATICAS=sim`.
             */
            if (env.SUGESTOES_AUTOMATICAS === 'sim' && agora.getUTCHours() === 4 && agora.getUTCMinutes() === 0) {
                const varridos = await varrerCandidatosASugestao(cliente, { agora, fila: env.CONHECIMENTO })
                if (varridos.length > 0) console.log('[sugestoes]', JSON.stringify(varridos))
            }
        } finally {
            await descartarCliente(cliente)
        }
    },
}

/// O Durable Object precisa ser exportado pelo módulo de entrada do Worker.
export { SalaDoChamado } from './tempo-real/sala.ts'
