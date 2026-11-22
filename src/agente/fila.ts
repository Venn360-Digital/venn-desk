import { createAnthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

import { appPorId } from '../dados/apps.ts'
import { criarCliente, descartarCliente } from '../dados/cliente.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { atender } from './atender.ts'
import { embutidorDoWorkersAi } from '../conhecimento/embeddings.ts'
import { saidaDeAprovacao, saidaDeEngenharia } from '../engenharia/ao-escalar.ts'

/**
 * A fila do atendimento automático (Fase 4).
 *
 * **Por que fila e não chamada direta.** O agente leva dezenas de segundos:
 * lê, busca parecidos, classifica, escreve. Fazer isso dentro da requisição que
 * abre o chamado obrigaria o cliente a esperar a IA para ver "chamado criado" —
 * e o widget pareceria travado justamente no momento em que a pessoa já está
 * irritada com outra coisa. A fila separa as duas: a abertura responde na hora,
 * o atendimento acontece em seguida.
 *
 * **O que entra na mensagem.** Só identificadores. O conteúdo do chamado é
 * relido pelo consumidor, e isso não é desperdício: entre o enfileiramento e o
 * consumo o chamado pode ter mudado — um humano pode tê-lo assumido, o cliente
 * pode ter escrito de novo. Carregar uma cópia significaria atender o chamado
 * que existia, não o que existe.
 */

const esquemaDoPedido = z.object({
    appId: z.string().min(1),
    numero: z.number().int().positive(),
})

export type PedidoDaFila = z.infer<typeof esquemaDoPedido>

/**
 * Enfileira, e nunca derruba quem chamou.
 *
 * Falhar em enfileirar significa que o chamado não será atendido pela IA — uma
 * pessoa vai pegá-lo, que é o estado normal de todo app com atendimento
 * automático desligado. Transformar isso num erro na tela do cliente trocaria
 * um atendimento mais lento por um chamado não aberto.
 */
export async function enfileirarAtendimento(
    fila: Ambiente['Bindings']['ATENDIMENTO'],
    pedido: PedidoDaFila
): Promise<void> {
    if (fila === undefined) return

    try {
        await fila.send(pedido)
    } catch (erro) {
        console.error('[fila] não consegui enfileirar o atendimento:', erro)
    }
}

/** O que o Workers entrega ao consumidor. Só o que usamos. */
export interface LoteDaFila {
    /** O nome da fila: é por ele que `src/index.ts` despacha ao consumidor certo. */
    queue: string
    messages: { body: unknown; ack(): void; retry(): void }[]
}

export async function consumirAtendimentos(
    lote: LoteDaFila,
    env: Ambiente['Bindings']
): Promise<void> {
    const chave = env.ANTHROPIC_API_KEY
    const cliente = criarCliente(env.DATABASE_URL)

    try {
        for (const mensagem of lote.messages) {
            const pedido = esquemaDoPedido.safeParse(mensagem.body)
            if (!pedido.success) {
                /// Mensagem malformada não melhora com repetição: `ack` para
                /// ela sair da fila em vez de voltar três vezes.
                console.error('[fila] pedido inválido, descartando:', mensagem.body)
                mensagem.ack()
                continue
            }

            if (chave === undefined || chave === '') {
                console.error('[fila] sem ANTHROPIC_API_KEY: o chamado fica para um humano')
                mensagem.ack()
                continue
            }

            try {
                const app = await appPorId(cliente, pedido.data.appId)
                /**
                 * A chave é conferida AQUI, e não só no enfileiramento.
                 *
                 * Entre uma coisa e outra alguém pode ter desligado o
                 * atendimento automático do app — e a fila não deve atender
                 * (nem gastar) contra uma decisão tomada depois.
                 */
                if (app === null || !app.atendimentoAutomatico) {
                    mensagem.ack()
                    continue
                }

                await atender({
                    modelo: createAnthropic({ apiKey: chave })(
                        env.MODELO_DO_AGENTE ?? 'claude-sonnet-5'
                    ),
                    esforco: (env.ESFORCO_DO_AGENTE ?? 'medium') as 'medium',
                    contexto: {
                        cliente,
                        escopoDoApp: escopoDoApp(cliente, app.id),
                        app,
                        escopo: 'SUPORTE',
                        ...(env.AI === undefined ? {} : { embutir: embutidorDoWorkersAi(env.AI) }),
                        abrirEngenharia: saidaDeEngenharia(escopoDoApp(cliente, app.id), app, env),
                        pedirAprovacao: saidaDeAprovacao(app, env),
                    },
                    numero: pedido.data.numero,
                    tarifa: {
                        entradaPorMilhao: Number(env.TARIFA_ENTRADA_POR_MILHAO ?? '3'),
                        saidaPorMilhao: Number(env.TARIFA_SAIDA_POR_MILHAO ?? '15'),
                    },
                })

                mensagem.ack()
            } catch (erro) {
                /**
                 * `retry` e não `ack`: falha de modelo costuma ser transitória
                 * — limite de taxa, instabilidade. O teto de tentativas está na
                 * configuração da fila, e depois dele o chamado simplesmente
                 * fica para uma pessoa, que é o comportamento correto.
                 */
                console.error('[fila] atendimento falhou:', erro)
                mensagem.retry()
            }
        }
    } finally {
        await descartarCliente(cliente)
    }
}
