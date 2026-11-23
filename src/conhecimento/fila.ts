import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

import { appPorId, appsSincronizaveis } from '../dados/apps.ts'
import { criarCliente, descartarCliente } from '../dados/cliente.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import type { LoteDaFila } from '../agente/fila.ts'
import { embutirVarios } from './embeddings.ts'
import { registrarGasto } from '../dados/gastos.ts'
import { custoEstimado } from '../agente/orcamento.ts'
import { extratorDaAnthropic } from './extrair/com-modelo.ts'
import { ErroDeLeitura, leitorGitHub } from './github.ts'
import { credencialDoAmbiente } from './github-app.ts'
import { documentarTela } from './documentar.ts'
import { sincronizarApp, type ResultadoDaSincronizacao } from './sincronizar.ts'
import { sugerirDeChamado, sugerirDeLacuna, type ResultadoDaSugestao } from './sugerir.ts'
import { diagnosticar, diagnosticoEmTexto } from '../engenharia/diagnosticar.ts'
import { arquivosDaTela } from '../engenharia/candidatos.ts'
import { espelharNosIrmaos } from '../engenharia/irmaos.ts'
import { anonimizar } from './privacidade.ts'
import { postar } from '../slack/cliente.ts'
import type { LanguageModel } from 'ai'

/**
 * O chamado vem por id, e pode não existir mais (exclusão lógica entre a
 * varredura e a fila). Nesse caso não há sugestão nem erro: a mensagem é
 * reconhecida e nada acontece.
 */
async function sugerirDoChamadoDaFila(
    escopo: ReturnType<typeof escopoDoApp>,
    ticketId: string,
    modelo: LanguageModel
): Promise<ResultadoDaSugestao | null> {
    const chamado = await escopo.chamados.paraSugestao(ticketId)
    if (chamado === null) return null
    return sugerirDeChamado({ escopo, chamado, extrator: extratorDaAnthropic(modelo), agora: new Date() })
}

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
    z.object({
        tipo: z.literal('documentar-tela'),
        rota: z.string().min(1).max(200),
        commitSha: z.string().length(40),
        arquivos: z
            .array(
                z.object({
                    caminho: z.string().min(1).max(300),
                    sha: z.string().min(4).max(64),
                    papel: z.enum(['tela', 'apoio']),
                })
            )
            .min(1)
            .max(20),
        appIds: z.array(z.string().min(1)).min(1).max(10),
    }),
    /**
     * O diagnóstico do N2 (Fase 5).
     *
     * Nesta fila, e não numa própria, porque é a fila de trabalho longo que
     * existe: ler doze arquivos do GitHub e chamar o modelo leva dezenas de
     * segundos, e criar outra fila exige provisionamento que não se faz num
     * deploy. O `resumo` viaja na mensagem porque é o texto que o N1 escreveu
     * ao escalar, e ele não está em lugar nenhum além do evento.
     */
    z.object({
        tipo: z.literal('diagnosticar-chamado'),
        appId: z.string().min(1),
        chamadoId: z.string().min(1),
        resumo: z.string().min(3).max(4_000),
    }),
    z.object({ tipo: z.literal('sugerir-de-chamado'), appId: z.string().min(1), ticketId: z.string().min(1) }),
    z.object({ tipo: z.literal('sugerir-de-lacuna'), appId: z.string().min(1), exemplo: z.string().min(1), vezes: z.number().int() }),
])

export type PedidoDeConhecimento = z.infer<typeof esquemaDoPedidoDeConhecimento>

/** O modelo da extração por modelo. `var`, para trocar sem publicar código. */
export const MODELO_PADRAO_DO_EXTRATOR = 'claude-sonnet-5'
/**
 * O modelo de quando a tela já tinha artigo e só mudou — um dos botões de custo
 * do plano. Reler um arquivo parecido com o que já rendeu JSON válido é trabalho
 * de Haiku, e a ancoragem reprova se ele errar.
 */
export const MODELO_INCREMENTAL = 'claude-haiku-4-5-20251001'
/** O modelo da biblioteca de casos. Reescrever texto que existe é de Haiku. */
export const MODELO_DO_SUGERIDOR = 'claude-haiku-4-5-20251001'
/**
 * O modelo do diagnóstico do N2. Sonnet, e não Haiku: aqui a tarefa é raciocinar
 * sobre código que ninguém resumiu, e um palpite errado manda uma pessoa
 * procurar no lugar errado.
 */
export const MODELO_DO_DIAGNOSTICO = 'claude-sonnet-5'

/** A tarifa só estima para a trilha; quem corta é o teto (ver `orcamento.ts`). */
function tarifaDoAmbiente(env: Ambiente['Bindings']): { entradaPorMilhao: number; saidaPorMilhao: number } {
    return {
        entradaPorMilhao: Number(env.TARIFA_ENTRADA_POR_MILHAO ?? '3'),
        saidaPorMilhao: Number(env.TARIFA_SAIDA_POR_MILHAO ?? '15'),
    }
}

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

            if (pedido.data.tipo === 'diagnosticar-chamado') {
                const chaveDoModelo = env.ANTHROPIC_API_KEY
                const credencialDoGitHub = credencialDoAmbiente(env)
                if (chaveDoModelo === undefined || chaveDoModelo === '' || credencialDoGitHub === undefined) {
                    console.error('[n2] sem chave do modelo ou do GitHub: o chamado fica sem diagnóstico')
                    mensagem.ack()
                    continue
                }

                try {
                    const app = await appPorId(cliente, pedido.data.appId)
                    if (app === null || app.repositorio === null) {
                        mensagem.ack()
                        continue
                    }

                    const escopo = escopoDoApp(cliente, app.id)
                    const chamado = await escopo.chamados.porId(pedido.data.chamadoId)
                    if (chamado === null) {
                        mensagem.ack()
                        continue
                    }

                    const leitor = leitorGitHub(credencialDoGitHub)
                    const rota = (chamado.contexto as { rota?: unknown } | null)?.rota
                    const candidatos = typeof rota === 'string' ? await arquivosDaTela(escopo, rota) : []

                    const resultado = await diagnosticar({
                        /// O resumo vem do evento de escalonamento, escrito pela
                        /// IA a partir do chamado: anonimizar antes de mandá-lo
                        /// ao modelo é a mesma regra da biblioteca de casos — o
                        /// que não entra no prompt não volta na resposta.
                        resumo: anonimizar(pedido.data.resumo),
                        candidatos,
                        repositorio: app.repositorio,
                        commitSha: await leitor.shaDoRamo(app.repositorio, 'main'),
                        leitor,
                        extrator: extratorDaAnthropic(
                            createAnthropic({ apiKey: chaveDoModelo })(env.MODELO_DO_DIAGNOSTICO ?? MODELO_DO_DIAGNOSTICO)
                        ),
                    })

                    /**
                     * O diagnóstico é NOTA INTERNA, sempre.
                     *
                     * Ele cita caminho de arquivo e nome de função — exatamente
                     * o que nunca chega ao cliente (ADR 0012). Quem lê é quem
                     * vai corrigir, no Console ou na thread de engenharia.
                     */
                    if (resultado.diagnostico !== null) {
                        await escopo.mensagens.adicionar(
                            {
                                ticketId: chamado.id,
                                autor: 'IA',
                                corpo: diagnosticoEmTexto(resultado),
                                visibilidade: 'INTERNA',
                                origem: 'MCP',
                            },
                            { ator: 'ia:n2' }
                        )

                        const thread = await escopo.threadsDoSlack.porChamado(chamado.id)
                        if (thread?.canalEngenharia != null && thread.threadTsEngenharia != null) {
                            await postar(
                                { token: env.SLACK_BOT_TOKEN },
                                {
                                    canal: thread.canalEngenharia,
                                    naThread: thread.threadTsEngenharia,
                                    mensagem: {
                                        text: diagnosticoEmTexto(resultado),
                                        blocks: [
                                            { type: 'section', text: { type: 'mrkdwn', text: diagnosticoEmTexto(resultado) } },
                                        ],
                                    },
                                }
                            )
                        }
                    }

                    /**
                     * Diagnóstico que aponta o core: os irmãos têm o mesmo
                     * defeito e só não têm chamado ainda.
                     *
                     * Aqui, e não no escalonamento, porque é o diagnóstico que
                     * sabe QUAIS arquivos estão envolvidos — antes dele só há o
                     * sintoma, e espelhar por sintoma criaria defeito em três
                     * apps a cada chamado escalado.
                     */
                    const suspeitos = resultado.diagnostico?.arquivosSuspeitos.map((a) => a.caminho) ?? []
                    if (suspeitos.length > 0 && chamado.problemId !== null) {
                        const espelhos = await espelharNosIrmaos({
                            cliente,
                            appDeOrigem: { id: app.id, slug: app.slug, repositorio: app.repositorio },
                            numeroDeOrigem: `${app.prefixo}-${chamado.numero}`,
                            titulo: chamado.assunto,
                            caminhos: suspeitos,
                        })
                        if (espelhos.length > 0) console.log('[irmaos]', JSON.stringify(espelhos))
                    }

                    await escopo.eventos.registrar({
                        ticketId: chamado.id,
                        ator: 'ia:n2',
                        evento: 'n2:diagnostico',
                        depois: {
                            arquivosLidos: resultado.arquivosLidos,
                            confianca: resultado.diagnostico?.confianca ?? null,
                            descartados: resultado.descartados,
                            ...(resultado.motivo === undefined ? {} : { motivo: resultado.motivo }),
                        },
                    })

                    await registrarGasto(cliente, {
                        appId: app.id,
                        origem: 'diagnostico',
                        referencia: pedido.data.chamadoId,
                        modelo: env.MODELO_DO_DIAGNOSTICO ?? MODELO_DO_DIAGNOSTICO,
                        custoUsd: custoEstimado(resultado.consumo, tarifaDoAmbiente(env)),
                    })

                    console.log('[n2] diagnóstico', JSON.stringify({ app: app.slug, arquivos: resultado.arquivosLidos, confianca: resultado.diagnostico?.confianca ?? null, motivo: resultado.motivo }))
                } catch (erro) {
                    /// `ack`: um diagnóstico não melhora repetindo, e o chamado
                    /// está com uma pessoa de qualquer forma.
                    console.error('[n2] diagnóstico falhou:', erro instanceof Error ? erro.message : erro)
                }
                mensagem.ack()
                continue
            }

            if (pedido.data.tipo === 'sugerir-de-chamado' || pedido.data.tipo === 'sugerir-de-lacuna') {
                const chaveDoModelo = env.ANTHROPIC_API_KEY
                if (chaveDoModelo === undefined || chaveDoModelo === '') {
                    console.error('[conhecimento] sem ANTHROPIC_API_KEY: a sugestão fica sem rascunho')
                    mensagem.ack()
                    continue
                }

                try {
                    /**
                     * Haiku, não Sonnet. Escrever um caso a partir de um
                     * chamado já resolvido é reescrever texto que existe, e
                     * quem lê o rascunho é uma pessoa antes de publicar — o
                     * erro aqui custa um clique, não um cliente.
                     */
                    const modelo = createAnthropic({ apiKey: chaveDoModelo })(
                        env.MODELO_DO_SUGERIDOR ?? MODELO_DO_SUGERIDOR
                    )
                    const escopo = escopoDoApp(cliente, pedido.data.appId)
                    const resultado =
                        pedido.data.tipo === 'sugerir-de-chamado'
                            ? await sugerirDoChamadoDaFila(escopo, pedido.data.ticketId, modelo)
                            : await sugerirDeLacuna({
                                  escopo,
                                  exemplo: pedido.data.exemplo,
                                  vezes: pedido.data.vezes,
                                  extrator: extratorDaAnthropic(modelo),
                                  agora: new Date(),
                              })

                    if (resultado !== null) {
                        await registrarGasto(cliente, {
                            appId: pedido.data.appId,
                            origem: 'sugestao',
                            referencia: resultado.chave,
                            modelo: env.MODELO_DO_SUGERIDOR ?? MODELO_DO_SUGERIDOR,
                            custoUsd: custoEstimado(resultado.consumo, tarifaDoAmbiente(env)),
                        })
                    }

                    if (resultado !== null && (resultado.criou || resultado.recusa !== null)) {
                        console.log('[conhecimento] sugestão', JSON.stringify({ tipo: pedido.data.tipo, chave: resultado.chave, criou: resultado.criou, recusa: resultado.recusa }))
                    }
                } catch (erro) {
                    /// `ack`: a sugestão não melhora repetindo, e o chamado
                    /// continua lá para a varredura de amanhã.
                    console.error('[conhecimento] sugestão falhou:', erro instanceof Error ? erro.message : erro)
                }
                mensagem.ack()
                continue
            }

            const credencial = credencialDoAmbiente(env)
            if (credencial === undefined) {
                console.error('[conhecimento] sem credencial do GitHub (App ou token): a base viva não roda')
                /// Só a sincronização tem onde registrar a falha; a tela deixa
                /// o artigo desatualizado, e a rodada seguinte a repede.
                if (pedido.data.tipo === 'sincronizar') {
                    await marcarFalha(cliente, pedido.data, 'sem credencial do GitHub no Worker (App ou GITHUB_TOKEN_LEITURA)')
                }
                mensagem.ack()
                continue
            }

            const chaveDoModelo = env.ANTHROPIC_API_KEY
            const anthropic = chaveDoModelo === undefined || chaveDoModelo === '' ? null : createAnthropic({ apiKey: chaveDoModelo })

            if (pedido.data.tipo === 'documentar-tela') {
                if (anthropic === null) {
                    console.error('[conhecimento] sem ANTHROPIC_API_KEY: a tela fica sem documentação')
                    mensagem.ack()
                    continue
                }
                try {
                    const apps = (await Promise.all(pedido.data.appIds.map((id) => appPorId(cliente, id))))
                        .filter((a): a is NonNullable<typeof a> => a !== null && a.repositorio !== null && a.pastaNoRepositorio !== null)
                        .map((a) => ({
                            id: a.id,
                            slug: a.slug,
                            nome: a.nome,
                            repositorio: a.repositorio as string,
                            pastaNoRepositorio: a.pastaNoRepositorio as string,
                        }))
                    if (apps.length === 0) {
                        mensagem.ack()
                        continue
                    }

                    const ai = env.AI
                    const resultado = await documentarTela({
                        rota: pedido.data.rota,
                        arquivos: pedido.data.arquivos,
                        commitSha: pedido.data.commitSha,
                        apps,
                        escopoDe: (appId) => escopoDoApp(cliente, appId),
                        leitor: leitorGitHub(credencial),
                        extrator: extratorDaAnthropic(anthropic(env.MODELO_DO_EXTRATOR ?? MODELO_PADRAO_DO_EXTRATOR)),
                        extratorIncremental: extratorDaAnthropic(anthropic(env.MODELO_DO_EXTRATOR_INCREMENTAL ?? MODELO_INCREMENTAL)),
                        embutir: ai === undefined ? null : (textos) => embutirVarios(ai, textos),
                        agora: new Date(),
                        tarifa: {
                            entradaPorMilhao: Number(env.TARIFA_ENTRADA_POR_MILHAO ?? '3'),
                            saidaPorMilhao: Number(env.TARIFA_SAIDA_POR_MILHAO ?? '15'),
                        },
                    })
                    /**
                     * O custo da tela entra na contabilidade AQUI, e é a lacuna
                     * que o incidente de 20/11/2026 revelou: cada tela é uma
                     * mensagem de fila à parte, então o valor nunca chegava ao
                     * resultado da sincronização e vivia só no log do Worker,
                     * que expira.
                     */
                    await registrarGasto(cliente, {
                        appId: apps[0]?.id ?? null,
                        origem: 'tela',
                        referencia: pedido.data.rota,
                        modelo: env.MODELO_DO_EXTRATOR ?? MODELO_PADRAO_DO_EXTRATOR,
                        custoUsd: resultado.custoEstimadoUsd,
                    })

                    if (resultado.artigos > 0 || resultado.custoEstimadoUsd > 0) {
                        console.log('[conhecimento] tela documentada', JSON.stringify(resultado))
                    }
                    mensagem.ack()
                } catch (erro) {
                    if (erro instanceof ErroDeLeitura && erro.codigoDeLeitura === 'limite_de_taxa') {
                        mensagem.retry()
                        continue
                    }
                    /**
                     * `ack`, não `retry`: falha de forma ou de ancoragem não
                     * melhora repetindo. O artigo da tela fica desatualizado, e
                     * a rodada seguinte o vê assim e tenta de novo — com um
                     * commit novo, que é quando pode ter melhorado.
                     */
                    console.error(`[conhecimento] tela ${pedido.data.rota} falhou:`, erro instanceof Error ? erro.message : erro)
                    mensagem.ack()
                }
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
                const extrator =
                    anthropic === null
                        ? null
                        : extratorDaAnthropic(anthropic(env.MODELO_DO_EXTRATOR ?? MODELO_PADRAO_DO_EXTRATOR))
                const ai = env.AI

                /// Os apps que compartilham este repositório: a tela é a mesma
                /// nos três, e a mensagem documenta todos de uma vez.
                const todos = await appsSincronizaveis(cliente)
                const irmaos = todos
                    .filter((a) => a.repositorio === app.repositorio)
                    .map((a) => ({
                        id: a.id,
                        slug: a.slug,
                        nome: a.nome,
                        repositorio: a.repositorio as string,
                        pastaNoRepositorio: a.pastaNoRepositorio as string,
                    }))

                const resultado = await sincronizarApp({
                    escopo,
                    app: { id: app.id, slug: app.slug, nome: app.nome, repositorio: app.repositorio, pastaNoRepositorio: app.pastaNoRepositorio },
                    leitor: leitorGitHub(credencial),
                    extrator,
                    embutir: ai === undefined ? null : (textos) => embutirVarios(ai, textos),
                    commitSha: pedido.data.commitSha,
                    anterior: pedido.data.forcar === true ? null : ((anterior?.resultado as ResultadoDaSincronizacao | null) ?? null),
                    agora,
                    fila: env.CONHECIMENTO,
                    irmaos,
                    tarifa: {
                        entradaPorMilhao: Number(env.TARIFA_ENTRADA_POR_MILHAO ?? '3'),
                        saidaPorMilhao: Number(env.TARIFA_SAIDA_POR_MILHAO ?? '15'),
                    },
                })

                await registrarGasto(cliente, {
                    appId: app.id,
                    origem: 'sincronizacao',
                    referencia: resultado.commit.slice(0, 7),
                    modelo: env.MODELO_DO_EXTRATOR ?? MODELO_PADRAO_DO_EXTRATOR,
                    custoUsd: resultado.custoEstimadoUsd,
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
