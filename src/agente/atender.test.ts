import { describe, expect, it } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'

import { atender } from './atender.ts'
import type { Contexto } from '../mcp/executar.ts'

const TARIFA = { entradaPorMilhao: 3, saidaPorMilhao: 15 }

/**
 * A forma que o protocolo V4 do provedor exige — e que eu errei duas vezes
 * antes de ler o tipo.
 *
 * `usage` é ANINHADO (`inputTokens: { total, … }`), e `finishReason` é um
 * OBJETO com `unified`, não a string. Com a string, o SDK tratava "tool-calls"
 * como fim de conversa e o laço parava no primeiro passo — o mock dizia uma
 * coisa e o teste media outra.
 */
const usar = (entrada: number, saida: number) =>
    ({
        inputTokens: { total: entrada, noCache: entrada, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: saida, text: saida, reasoning: 0 },
    }) as never

const fim = (unified: 'stop' | 'tool-calls') =>
    ({ unified, raw: unified }) as never

interface Gravado {
    eventos: { evento: string; depois?: unknown }[]
    mensagens: { corpo: string; visibilidade?: string }[]
    notas: string[]
}

/**
 * Um escopo falso que só registra o que recebeu.
 *
 * O que se prova aqui é o LAÇO — quantas vezes ele roda, quando para, o que
 * deixa na trilha. O comportamento das ferramentas já é provado em
 * `src/mcp/`, e repetir aquilo com banco de verdade tornaria esta prova lenta
 * sem acrescentar garantia.
 */
function contextoFalso(
    modoSombra = false
): { contexto: Contexto; gravado: Gravado } {
    const gravado: Gravado = { eventos: [], mensagens: [], notas: [] }

    const escopoDoApp = {
        appId: 'app-1',
        chamados: {
            porNumero: async () => ({ id: 'chamado-1', numero: 1042 }),
        },
        eventos: {
            registrar: async (dados: { evento: string; depois?: unknown }) => {
                gravado.eventos.push(dados)
                return {}
            },
        },
        mensagens: {
            adicionar: async (dados: { corpo: string; visibilidade?: string }) => {
                gravado.mensagens.push(dados)
                return {}
            },
            todas: async () => [],
        },
        solicitantes: { porId: async () => ({ nome: 'Ana', email: 'ana@x.com' }) },
        empresas: { porId: async () => ({ id: 't', nome: 'Clínica', plano: null, conta: null }) },
        sla: { doChamado: async () => [] },
    }

    return {
        gravado,
        contexto: {
            cliente: {} as Contexto['cliente'],
            escopoDoApp: escopoDoApp as unknown as Contexto['escopoDoApp'],
            app: {
                id: 'app-1',
                nome: 'Odontobox360',
                prefixo: 'ODB',
                modoSombra,
                instrucoesDoAgente: null,
            } as unknown as Contexto['app'],
            escopo: 'SUPORTE',
        },
    }
}

/** Um modelo que chama `nota_interna` para sempre — o laço que o teto corta. */
function modeloEmLaco() {
    let n = 0
    return new MockLanguageModelV4({
        doGenerate: async () => {
            n += 1
            return {
                content: [
                    {
                        type: 'tool-call' as const,
                        toolCallId: `c${n}`,
                        toolName: 'nota_interna',
                        input: JSON.stringify({ numero: 'ODB-1042', corpo: `volta ${n}` }),
                    },
                ],
                finishReason: fim('tool-calls'),
                usage: usar(100, 20),
                warnings: [],
            }
        },
    })
}

/** Um modelo que responde uma vez e para. */
function modeloQueConclui(texto: string) {
    return new MockLanguageModelV4({
        doGenerate: async () => ({
            content: [{ type: 'text' as const, text: texto }],
            finishReason: fim('stop'),
            usage: usar(80, 30),
            warnings: [],
        }),
    })
}

describe('o agente de atendimento', () => {
    it('para no teto de PASSOS em vez de rodar para sempre', async () => {
        const { contexto, gravado } = contextoFalso()

        const r = await atender({
            modelo: modeloEmLaco(),
            contexto,
            numero: 1042,
            tarifa: TARIFA,
            teto: { passos: 4, tokens: 999_999 },
        })

        expect(r.fim).toBe('teto')
        expect(r.consumo.passos).toBe(4)
        expect(gravado.notas.length + gravado.mensagens.length).toBeGreaterThan(0)
    })

    it('o estouro vira nota interna, para o chamado não parecer abandonado', async () => {
        /**
         * Sem isto, um chamado em que o agente parou no meio fica igual a um
         * que ninguém pegou — e é pior, porque já tem respostas pela metade.
         */
        const { contexto, gravado } = contextoFalso()

        await atender({
            modelo: modeloEmLaco(),
            contexto,
            numero: 1042,
            tarifa: TARIFA,
            teto: { passos: 3, tokens: 999_999 },
        })

        const nota = gravado.mensagens.find((m) => m.corpo.includes('teto de gasto'))
        expect(nota?.visibilidade).toBe('INTERNA')
        expect(nota?.corpo).toMatch(/precisa de uma pessoa/i)
    })

    it('para no teto de TOKENS mesmo com poucos passos', async () => {
        /// Um chamado enorme estoura no primeiro passo, e um teto só de passos
        /// não pegaria isso.
        const { contexto } = contextoFalso()

        const r = await atender({
            modelo: modeloEmLaco(),
            contexto,
            numero: 1042,
            tarifa: TARIFA,
            teto: { passos: 50, tokens: 200 },
        })

        expect(r.fim).toBe('teto')
        expect(r.consumo.passos).toBeLessThan(50)
    })

    it('o consumo e o custo vão para a trilha de auditoria', async () => {
        /// "Quanto a IA gastou neste chamado" só tem resposta se for gravado
        /// no chamado — na fatura do mês ela já vem agregada.
        const { contexto, gravado } = contextoFalso()

        await atender({ modelo: modeloQueConclui('terminei'), contexto, numero: 1042, tarifa: TARIFA })

        const evento = gravado.eventos.find((e) => e.evento.startsWith('agente:'))
        const depois = evento?.depois as Record<string, unknown>

        expect(evento?.evento).toBe('agente:atendeu')
        expect(depois['passos']).toBe(1)
        expect(depois['tokensDeEntrada']).toBe(80)
        expect(typeof depois['custoEstimadoUsd']).toBe('number')
    })

    it('a fala final do modelo NÃO vira mensagem ao cliente', async () => {
        /**
         * A confusão mais cara que este desenho pode ter. Só
         * `responder_usuario` fala com o cliente; o texto do modelo é
         * raciocínio, e publicá-lo mandaria ao cliente a conversa interna.
         */
        const { contexto, gravado } = contextoFalso()

        const r = await atender({
            modelo: modeloQueConclui('Vou verificar com a engenharia e volto.'),
            contexto,
            numero: 1042,
            tarifa: TARIFA,
        })

        expect(r.ultimaFala).toContain('Vou verificar')
        expect(gravado.mensagens.some((m) => m.corpo.includes('Vou verificar'))).toBe(false)
    })

    it('conclui sem estourar quando o modelo para sozinho', async () => {
        const { contexto } = contextoFalso()

        const r = await atender({
            modelo: modeloQueConclui('pronto'),
            contexto,
            numero: 1042,
            tarifa: TARIFA,
        })

        expect(r.fim).toBe('concluiu')
        expect(r.chamadas).toEqual([])
    })
})
