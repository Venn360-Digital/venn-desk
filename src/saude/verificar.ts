import type { App, PrismaClient } from '#prisma'

import { appsAtivos } from '../dados/apps.ts'
import { responsaveisPorAlerta } from '../dados/agentes.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import type { CaixaDeSaida, Remetente } from '../correio/enviar.ts'

import {
    TEMPO_LIMITE_MS,
    transicionarSaude,
    type Sondagem,
} from './transicao.ts'

/**
 * A verificação de saúde de cada app, a cada minuto — item 1 da contingência
 * (seção 7): "na falha, cria um problema urgente, posta no canal de engenharia
 * mencionando @Claude, alerta os responsáveis e publica o incidente na página
 * de status".
 *
 * Três das quatro consequências já acontecem aqui: o problema, o alerta aos
 * responsáveis e a publicação (a página lê `/api/status`, que lê o episódio).
 * A quarta — postar no canal de engenharia — depende da ponte com o Slack, que
 * é a outra metade desta fase.
 *
 * **Por que o Venn Desk pode verificar e os apps não podem se verificar.** Um
 * app fora do ar não anuncia a própria queda. O verificador tem de rodar em
 * outro lugar, e o Venn Desk é esse lugar porque é Worker separado, com banco
 * separado. O que ele NÃO cobre é pane da Cloudflare ou da Neon, que derruba os
 * dois — e é por isso que a página de status é estática e mora fora (seção 7).
 */

/** A sondagem é injetável para a prova não depender de rede. */
export type Sonda = (url: string) => Promise<Sondagem>

export const sondaHttp: Sonda = async (url) => {
    const comecou = Date.now()

    try {
        const resposta = await fetch(url, {
            method: 'GET',
            /**
             * `cacheTtl: 0` e `no-cache`: um 200 vindo do cache da borda não
             * prova que o app responde. A verificação tem de alcançar a origem,
             * ou mede a Cloudflare em vez de medir o app.
             *
             * (`cache: 'no-store'` do fetch padrão não existe no Workers — o
             * controle é pelo `cf`.)
             */
            cf: { cacheTtl: 0 },
            redirect: 'manual',
            headers: {
                'User-Agent': 'venn-desk-saude/1 (+https://desk.venn360.com)',
                'Cache-Control': 'no-cache',
            },
            signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
        })

        return {
            /// 2xx e 3xx passam. Redirecionamento é resposta: um app que manda
            /// a raiz para `/entrar` está de pé.
            ok: resposta.status >= 200 && resposta.status < 400,
            latenciaMs: Date.now() - comecou,
            detalhe: String(resposta.status),
        }
    } catch (erro) {
        /// Só o NOME do erro. A mensagem de um `fetch` que falhou pode carregar
        /// a URL inteira, com o que vier de query.
        const nome = erro instanceof Error ? erro.name : 'ErroDesconhecido'
        return { ok: false, latenciaMs: Date.now() - comecou, detalhe: nome }
    }
}

export interface OpcoesDaVerificacao {
    sonda?: Sonda
    agora?: Date
    caixa?: CaixaDeSaida | undefined
    remetente?: Remetente | undefined
    urlStatus?: string | undefined
}

export interface Veredito {
    slug: string
    saudavel: boolean
    falhasSeguidas: number
    latenciaMs: number
    detalhe: string
    mudanca: 'caiu' | 'voltou' | null
    /** O problema aberto pela queda, quando a mudança foi `caiu`. */
    problemId?: string
}

export async function verificarSaude(
    cliente: PrismaClient,
    opcoes: OpcoesDaVerificacao = {}
): Promise<Veredito[]> {
    const sonda = opcoes.sonda ?? sondaHttp
    const agora = opcoes.agora ?? new Date()

    const apps = (await appsAtivos(cliente)).filter(
        (app): app is App & { urlSaude: string } =>
            typeof app.urlSaude === 'string' && app.urlSaude.length > 0
    )

    /**
     * Em paralelo, e um app não derruba o outro. Um `Promise.all` que rejeita
     * deixaria os apps restantes sem verificação naquele minuto — justamente
     * quando é mais provável que algo esteja errado.
     */
    const resultados = await Promise.allSettled(
        apps.map((app) => verificarUmApp(cliente, app, sonda, agora, opcoes))
    )

    const vereditos: Veredito[] = []
    for (const [indice, resultado] of resultados.entries()) {
        if (resultado.status === 'fulfilled') {
            vereditos.push(resultado.value)
            continue
        }
        console.error(`[saude] falhou ao verificar ${apps[indice]?.slug}:`, resultado.reason)
    }

    return vereditos
}

async function verificarUmApp(
    cliente: PrismaClient,
    app: App & { urlSaude: string },
    sonda: Sonda,
    agora: Date,
    opcoes: OpcoesDaVerificacao
): Promise<Veredito> {
    const escopo = escopoDoApp(cliente, app.id)

    const sondagem = await sonda(app.urlSaude)
    const anterior = await escopo.saude.estado()

    const transicao = transicionarSaude(
        anterior === null
            ? null
            : {
                  saudavel: anterior.saudavel,
                  falhasSeguidas: anterior.falhasSeguidas,
                  desdeEm: anterior.desdeEm,
              },
        sondagem,
        agora
    )

    await escopo.saude.gravarEstado({
        saudavel: transicao.saudavel,
        falhasSeguidas: transicao.falhasSeguidas,
        desdeEm: transicao.desdeEm,
        verificadoEm: agora,
        latenciaMs: sondagem.latenciaMs,
        detalhe: sondagem.detalhe,
    })

    const veredito: Veredito = {
        slug: app.slug,
        saudavel: transicao.saudavel,
        falhasSeguidas: transicao.falhasSeguidas,
        latenciaMs: sondagem.latenciaMs,
        detalhe: sondagem.detalhe,
        mudanca: transicao.mudanca,
    }

    if (transicao.mudanca === 'caiu') {
        /**
         * O problema nasce antes do episódio para o episódio já apontar para
         * ele. Se a criação do problema falhar, não existe episódio órfão
         * dizendo que houve queda sem nada para investigar.
         */
        const problema = await escopo.problemas.abrir({
            titulo: `URGENTE · ${app.nome} fora do ar`,
            causa:
                `A verificação de saúde de ${app.urlSaude} falhou ` +
                `${transicao.falhasSeguidas} vezes seguidas (último: ${sondagem.detalhe}). ` +
                `Detecção automática, seção 7.`,
        })

        await escopo.saude.abrirEpisodio({
            iniciadoEm: transicao.desdeEm,
            detalhe: sondagem.detalhe,
            problemId: problema.id,
        })

        veredito.problemId = problema.id
        await alertarResponsaveis(cliente, app, sondagem, opcoes)
    }

    if (transicao.mudanca === 'voltou') {
        const episodio = await escopo.saude.episodioAberto()
        if (episodio !== null) {
            await escopo.saude.fecharEpisodio(episodio.id, agora)
            /**
             * O problema é RESOLVIDO, não apagado: a seção 10 proíbe exclusão, e
             * o registro de que o app ficou fora por 14 minutos é exatamente o
             * que alguém vai querer ler depois. Resolver aqui também evita que a
             * fila de engenharia acumule panes que já passaram sozinhas.
             */
            if (episodio.problemId !== null) await escopo.problemas.resolver(episodio.problemId)
        }
    }

    return veredito
}

/**
 * O alerta aos responsáveis. Fora da trilha de `ticket_events` porque não há
 * chamado: a queda é do app, não de um atendimento.
 *
 * Nunca derruba a verificação — mesma razão do `src/correio/enviar.ts`: perder
 * o e-mail é ruim, perder a detecção é pior.
 */
async function alertarResponsaveis(
    cliente: PrismaClient,
    app: App,
    sondagem: Sondagem,
    opcoes: OpcoesDaVerificacao
): Promise<void> {
    if (opcoes.caixa === undefined || opcoes.remetente === undefined) return

    try {
        const responsaveis = await responsaveisPorAlerta(cliente)
        const linkStatus =
            opcoes.urlStatus === undefined ? '' : `\nPágina de status: ${opcoes.urlStatus}\n`

        const texto =
            `A verificação automática de saúde não obteve resposta de ${app.nome}.\n\n` +
            `Endereço verificado: ${app.urlSaude ?? '—'}\n` +
            `Último resultado: ${sondagem.detalhe} em ${sondagem.latenciaMs} ms\n` +
            `Um problema urgente foi aberto no Venn Desk.\n` +
            linkStatus +
            `\nEste endereço não recebe respostas.`

        await Promise.allSettled(
            responsaveis.map((agente) =>
                opcoes.caixa?.send({
                    from: { email: opcoes.remetente!.email, name: opcoes.remetente!.nome },
                    to: agente.email,
                    subject: `[URGENTE] ${app.nome} fora do ar`,
                    text: texto,
                    html: `<pre style="font:14px/1.5 ui-monospace,monospace">${texto
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')}</pre>`,
                })
            )
        )
    } catch (erro) {
        console.error('[saude] falha ao alertar responsáveis:', erro)
    }
}
