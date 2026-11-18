import { generateText, stepCountIs, tool, type LanguageModel } from 'ai'

import { formatarNumero } from '../dominio/numero.ts'
import { executarFerramenta, type Contexto } from '../mcp/executar.ts'
import { ferramentasDoEscopo } from '../mcp/ferramentas.ts'
import { montarInstrucoes } from './instrucoes.ts'
import {
    conferirTeto,
    paraATrilha,
    somar,
    TETO_PADRAO,
    totalDeTokens,
    ZERO,
    type Consumo,
    type Tarifa,
    type Teto,
} from './orcamento.ts'

/**
 * O agente de atendimento N1 e N2 (Fase 4).
 *
 * **Ele chama as MESMAS ferramentas do MCP, no mesmo processo.** Não há uma
 * segunda implementação do que o agente pode fazer: `executarFerramenta` é a
 * de sempre, com o mesmo escopo por app, as mesmas recusas e a mesma trilha.
 * Se existisse um caminho próprio aqui, toda garantia provada no MCP teria de
 * ser provada de novo — e a segunda cópia é a que envelhece.
 *
 * Também não passa pela rede: o MCP existe para quem está FORA do Worker (o
 * Claude no Slack, o Claude Code no terminal). Fazer o Worker chamar a própria
 * URL acrescentaria latência, uma credencial para rodar e um ponto de falha,
 * sem acrescentar nenhuma garantia.
 *
 * **Quem decide parar é o teto, não o modelo.** Ver `orcamento.ts`.
 */

export interface PedidoDeAtendimento {
    modelo: LanguageModel
    contexto: Contexto
    numero: number
    /** Para a trilha. O cálculo de custo não decide nada, só registra. */
    tarifa: Tarifa
    teto?: Teto
    /**
     * Quanto o modelo deve pensar antes de agir.
     *
     * É a alavanca de qualidade do Opus 5: separar um chamado de uso mal
     * explicado de um defeito de verdade é exatamente o julgamento que melhora
     * com raciocínio. O custo é proporcional à dificuldade — num "esqueci a
     * senha" quase não pesa.
     *
     * **A forma mudou com o modelo.** O Opus 5 recusa o `thinking.enabled` com
     * orçamento em tokens que o Sonnet aceitava, e pede `effort`. A API disse
     * isso com todas as letras — `"thinking.type.enabled" is not supported for
     * this model` — e é por isso que a rota de admin passou a mostrar o erro do
     * provedor em vez de engoli-lo.
     */
    esforco?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'
}

export interface Atendimento {
    consumo: Consumo
    /** Por que parou. `teto` é o caso que merece olhar. */
    fim: 'concluiu' | 'teto'
    /** As ferramentas que ele de fato chamou, em ordem. */
    chamadas: string[]
    /** O texto final do modelo. NÃO chega ao cliente — só a ferramenta chega. */
    ultimaFala: string
}

export async function atender(pedido: PedidoDeAtendimento): Promise<Atendimento> {
    const { contexto } = pedido
    const teto = pedido.teto ?? TETO_PADRAO
    const catalogo = ferramentasDoEscopo(contexto.escopo)
    const numeroLegivel = formatarNumero(contexto.app.prefixo, pedido.numero)

    const chamadas: string[] = []

    /**
     * As ferramentas do SDK são uma casca fina sobre o catálogo.
     *
     * A descrição e o esquema vêm de `ferramentas.ts` — os mesmos que o MCP
     * publica. Reescrevê-los aqui faria o agente e o Claude do Slack lerem
     * textos diferentes para a mesma ação, e a diferença só apareceria em
     * produção, como comportamento divergente entre os dois canais.
     */
    const ferramentas = Object.fromEntries(
        catalogo.map((f) => [
            f.nome,
            tool({
                description: f.descricao,
                inputSchema: f.argumentos,
                execute: async (argumentos: Record<string, unknown>) => {
                    chamadas.push(f.nome)
                    const resultado = await executarFerramenta(contexto, f.nome, argumentos)
                    return resultado.texto
                },
            }),
        ])
    )

    const instrucoes = montarInstrucoes({
        nomeDoApp: contexto.app.nome,
        numeroDoChamado: numeroLegivel,
        instrucoesDoApp: contexto.app.instrucoesDoAgente,
        modoSombra: contexto.app.modoSombra,
        ferramentas: catalogo,
    })

    let consumo: Consumo = ZERO

    const resposta = await generateText({
        model: pedido.modelo,
        system: instrucoes,
        ...(pedido.esforco === undefined
            ? {}
            : { providerOptions: { anthropic: { effort: pedido.esforco } } }),
        /**
         * O chamado NÃO é colado aqui.
         *
         * O primeiro turno diz apenas qual é o número; o conteúdo entra pela
         * ferramenta, já rotulado como dado não confiável. Colá-lo no prompt
         * inicial o colocaria no mesmo nível das instruções, que é exatamente
         * o que a marcação existe para evitar.
         */
        prompt: `Atenda o chamado ${numeroLegivel}. Comece lendo-o.`,
        tools: ferramentas,
        stopWhen: [
            stepCountIs(teto.passos),
            /// O teto de tokens também encerra: um chamado enorme estoura no
            /// primeiro passo, e `stepCountIs` sozinho não pegaria isso.
            ({ steps }) => {
                const gasto = steps.reduce<Consumo>(
                    (total, passo) =>
                        somar(total, {
                            passos: 1,
                            tokensDeEntrada: passo.usage?.inputTokens ?? 0,
                            tokensDeSaida: passo.usage?.outputTokens ?? 0,
                        }),
                    ZERO
                )
                return totalDeTokens(gasto) >= teto.tokens
            },
        ],
        onStepFinish: ({ usage }) => {
            consumo = somar(consumo, {
                passos: 1,
                tokensDeEntrada: usage?.inputTokens ?? 0,
                tokensDeSaida: usage?.outputTokens ?? 0,
            })
        },
    })

    const estourou = conferirTeto(consumo, teto).dentro === false

    /**
     * O que aconteceu fica na trilha, sempre — inclusive o custo.
     *
     * Sem isto, "quanto a IA gastou neste chamado" só teria resposta na fatura
     * do mês, agregada, quando já não dá para saber qual chamado foi caro.
     */
    const chamado = await contexto.escopoDoApp.chamados.porNumero(pedido.numero)
    if (chamado !== null) {
        await contexto.escopoDoApp.eventos.registrar({
            ticketId: chamado.id,
            ator: 'ia:agente',
            evento: estourou ? 'agente:teto' : 'agente:atendeu',
            depois: {
                ...paraATrilha(consumo, pedido.tarifa),
                ferramentas: chamadas.join(', '),
            },
        })

        /**
         * Estourar o teto NÃO é "terminou": é o agente parado no meio. Uma
         * nota interna fica no chamado para quem olhar a fila entender por que
         * ele está pela metade — sem ela, o chamado parece abandonado.
         */
        if (estourou) {
            await contexto.escopoDoApp.mensagens.adicionar(
                {
                    ticketId: chamado.id,
                    autor: 'IA',
                    corpo:
                        `O atendimento automático parou no teto de gasto ` +
                        `(${consumo.passos} passos, ${totalDeTokens(consumo)} tokens). ` +
                        `Este chamado precisa de uma pessoa.`,
                    visibilidade: 'INTERNA',
                    origem: 'MCP',
                },
                { ator: 'ia:agente' }
            )
        }
    }

    return {
        consumo,
        fim: estourou ? 'teto' : 'concluiu',
        chamadas,
        ultimaFala: resposta.text,
    }
}
