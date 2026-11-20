import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

import { appPorId } from '../dados/apps.ts'
import { criarCliente, descartarCliente } from '../dados/cliente.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import type { LoteDaFila } from '../agente/fila.ts'
import { embutirVarios } from './embeddings.ts'
import { extratorDaAnthropic } from './extrair/com-modelo.ts'
import { ErroDeLeitura, leitorGitHub } from './github.ts'
import { sincronizarApp, type ResultadoDaSincronizacao } from './sincronizar.ts'

/**
 * A fila da base viva (`CONHECIMENTO`).
 *
 * Três tipos de mensagem, um consumidor. `sincronizar` é a que existe hoje;
 * `sugerir-de-chamado` e `sugerir-de-lacuna` chegam com a biblioteca de casos
 * e, até lá, são reconhecidas e descartadas com `ack` — uma mensagem que o
 * consumidor não conhece não deve voltar três vezes.
 *
 * **Idempotente por (app, commit).** Uma sincronização já concluída para o
 * mesmo commit é `ack` imediato, salvo `forcar`. É isso que torna segura a
 * corrida entre o cron e o botão do Console.
 *
 * **O que repete e o que não.** Limite de taxa do GitHub repete (`retry`, com
 * o atraso da fila). Falha de forma (`ErroDeExtracao`) e qualquer outra NÃO
 * repetem: ficam em `kb_sincronizacoes.erro`, o Console pinta, e o próximo
 * tick do cron tenta de novo quando houver commit novo.
 */

export const esquemaDoPedidoDeConhecimento = z.discriminatedUnion('tipo', [
    z.object({
        tipo: z.literal('sincronizar'),
        appId: z.string().min(1),
        sincronizacaoId: z.string().min(1),
        commitSha: z.string().length(40),
        forcar: z.boolean().optional(),
    }),
    z.object({ tipo: z.literal('sugerir-de-chamado'), appId: z.string().min(1), ticketId: z.string().min(1) }),
    z.object({ tipo: z.literal('sugerir-de-lacuna'), appId: z.string().min(1), exemplo: z.string().min(1), vezes: z.number().int() }),
])

export type PedidoDeConhecimento = z.infer<typeof esquemaDoPedidoDeConhecimento>

/** O modelo da extração por modelo. `var`, para trocar sem publicar código. */
export const MODELO_PADRAO_DO_EXTRATOR = 'claude-sonnet-5'

export async function consumirConhecimento(lote: LoteDaFila, env: Ambiente['Bindings']): Promise<void> {
    const cliente = criarCliente(env.DATABASE_URL)

    try {
        for (const mensagem of lote.messages) {
            const pedido = esquemaDoPedidoDeConhecimento.safeParse(mensagem.body)
            if (!pedido.success) {
                console.error('[conhecimento] pedido inválido, descartando:', mensagem.body)
                mensagem.ack()
                continue
            }

            if (pedido.data.tipo !== 'sincronizar') {
                /// Chega com a biblioteca de casos. Até lá, reconhecido e fora.
                console.log('[conhecimento] tipo ainda não atendido:', pedido.data.tipo)
                mensagem.ack()
                continue
            }

            const token = env.GITHUB_TOKEN_LEITURA
            if (token === undefined || token === '') {
                console.error('[conhecimento] sem GITHUB_TOKEN_LEITURA: a sincronização não roda')
                await marcarFalha(cliente, pedido.data, 'sem GITHUB_TOKEN_LEITURA no Worker')
                mensagem.ack()
                continue
            }

            try {
                const app = await appPorId(cliente, pedido.data.appId)
                if (app === null || app.repositorio === null || app.pastaNoRepositorio === null) {
                    await marcarFalha(cliente, pedido.data, 'app sem repositório ou pasta cadastrados')
                    mensagem.ack()
                    continue
                }

                const escopo = escopoDoApp(cliente, app.id)
                const sincronizacao = await escopo.sincronizacoes.porId(pedido.data.sincronizacaoId)
                if (sincronizacao === null || sincronizacao.estado === 'concluida' || sincronizacao.estado === 'falhou') {
                    mensagem.ack()
                    continue
                }

                const agora = new Date()
                await escopo.sincronizacoes.iniciar(sincronizacao.id, agora)

                const anterior = await escopo.sincronizacoes.ultimaConcluida()
                const chave = env.ANTHROPIC_API_KEY
                const extrator =
                    chave === undefined || chave === ''
                        ? null
                        : extratorDaAnthropic(createAnthropic({ apiKey: chave })(env.MODELO_DO_EXTRATOR ?? MODELO_PADRAO_DO_EXTRATOR))
                const ai = env.AI

                const resultado = await sincronizarApp({
                    escopo,
                    app: { id: app.id, slug: app.slug, nome: app.nome, repositorio: app.repositorio, pastaNoRepositorio: app.pastaNoRepositorio },
                    leitor: leitorGitHub(token),
                    extrator,
                    embutir: ai === undefined ? null : (textos) => embutirVarios(ai, textos),
                    commitSha: pedido.data.commitSha,
                    anterior: pedido.data.forcar === true ? null : ((anterior?.resultado as ResultadoDaSincronizacao | null) ?? null),
                    agora,
                    tarifa: {
                        entradaPorMilhao: Number(env.TARIFA_ENTRADA_POR_MILHAO ?? '3'),
                        saidaPorMilhao: Number(env.TARIFA_SAIDA_POR_MILHAO ?? '15'),
                    },
                })

                await escopo.sincronizacoes.concluir(sincronizacao.id, resultado as never, new Date())
                console.log('[conhecimento] sincronizado', JSON.stringify({ app: app.slug, commit: resultado.commit.slice(0, 7), fontes: Object.fromEntries(Object.entries(resultado.fontes).map(([k, v]) => [k, v.estado])), custo: resultado.custoEstimadoUsd, ms: resultado.duracaoMs }))
                mensagem.ack()
            } catch (erro) {
                if (erro instanceof ErroDeLeitura && erro.codigoDeLeitura === 'limite_de_taxa') {
                    console.error('[conhecimento] limite do GitHub; tentando depois')
                    mensagem.retry()
                    continue
                }
                const texto = erro instanceof Error ? erro.message : String(erro)
                console.error('[conhecimento] sincronização falhou:', texto)
                await marcarFalha(cliente, pedido.data, texto)
                mensagem.ack()
            }
        }
    } finally {
        await descartarCliente(cliente)
    }
}

async function marcarFalha(
    cliente: ReturnType<typeof criarCliente>,
    pedido: Extract<PedidoDeConhecimento, { tipo: 'sincronizar' }>,
    erro: string
): Promise<void> {
    try {
        await escopoDoApp(cliente, pedido.appId).sincronizacoes.falhar(pedido.sincronizacaoId, erro, new Date())
    } catch (e) {
        console.error('[conhecimento] não consegui registrar a falha:', e)
    }
}
