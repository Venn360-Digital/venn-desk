import type { EscopoDoApp } from '../dados/escopo.ts'
import type { Autor } from '../dados/escopo.ts'

/**
 * Resolver em lote os chamados de um defeito (Fase 6).
 *
 * Um defeito de produção rende dezenas de chamados do mesmo assunto. Quando a
 * correção sai, responder um por um custa uma tarde — e metade fica sem resposta
 * porque alguém perdeu a conta.
 *
 * **O texto é obrigatório e escrito por uma pessoa.** Um aviso genérico ("seu
 * problema foi corrigido") chega igual para quem relatou coisas diferentes
 * agrupadas no mesmo defeito, e é exatamente o tipo de mensagem que faz o
 * cliente responder "não era isso". Quem resolve escreve o que foi corrigido.
 *
 * **Chamado por chamado, tolerando recusa.** A transição passa pela máquina de
 * estados: um chamado que já foi resolvido à mão, ou que o cliente reabriu entre
 * a consulta e a escrita, é recusado — e isso não impede os outros.
 */

export interface ResultadoDoLote {
    avisados: number
    resolvidos: number
    /** Os que não puderam ser resolvidos, com o motivo, para quem clicou ver. */
    recusados: { numero: number; motivo: string }[]
}

/** Teto por clique: um defeito com mil chamados não cabe numa requisição. */
export const TETO_POR_LOTE = 100

export async function resolverIncidentesDoDefeito(p: {
    escopo: EscopoDoApp
    problemaId: string
    /** O que foi corrigido, nas palavras de quem resolveu. Vai ao cliente. */
    texto: string
    autor: Autor
}): Promise<ResultadoDoLote | null> {
    const problema = await p.escopo.problemas.porId(p.problemaId)
    if (problema === null) return null

    const chamados = await p.escopo.chamados.listar({ limite: TETO_POR_LOTE })
    const doDefeito = chamados.filter(
        (c) => c.problemId === p.problemaId && c.status !== 'RESOLVIDO' && c.status !== 'FECHADO'
    )

    const resultado: ResultadoDoLote = { avisados: 0, resolvidos: 0, recusados: [] }

    for (const chamado of doDefeito) {
        try {
            /**
             * A mensagem vai ANTES da transição.
             *
             * Resolver é o que dispara o e-mail de encerramento e o pedido de
             * nota: sem a mensagem antes, o cliente receberia "seu chamado foi
             * resolvido" sem saber o que foi feito.
             */
            await p.escopo.mensagens.adicionar(
                {
                    ticketId: chamado.id,
                    autor: 'HUMANO',
                    corpo: p.texto,
                    visibilidade: 'PUBLICA',
                    origem: 'CONSOLE',
                    ...(p.autor.ator.startsWith('agent:')
                        ? { autorId: p.autor.ator.slice('agent:'.length) }
                        : {}),
                },
                p.autor
            )
            resultado.avisados += 1

            await p.escopo.chamados.aplicarEvento(chamado.id, 'resolver', p.autor)
            resultado.resolvidos += 1
        } catch (erro) {
            resultado.recusados.push({
                numero: chamado.numero,
                motivo: erro instanceof Error ? erro.message : 'erro',
            })
        }
    }

    return resultado
}
