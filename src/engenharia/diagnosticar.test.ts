import { describe, expect, it } from 'vitest'

import type { Extrator, PedidoDeExtracao } from '../conhecimento/extrair/com-modelo.ts'
import type { LeitorDoRepositorio } from '../conhecimento/github.ts'
import { diagnosticar, diagnosticoEmTexto, TETO_DE_ARQUIVOS } from './diagnosticar.ts'

const DIAGNOSTICO = {
    hipotese: 'A recorrência para no primeiro feriado porque o laço sai quando a data é bloqueada.',
    arquivosSuspeitos: [{ caminho: 'core/agenda/recorrencia.ts', porque: 'o laço de datas está aqui' }],
    comoVerificar: ['Criar recorrência semanal que caia num feriado e conferir quantas datas nascem'],
    confianca: 'alta' as const,
}

function leitorFalso(arquivos: Record<string, string>): LeitorDoRepositorio {
    const arvore = new Map(Object.keys(arquivos).map((caminho) => [caminho, { sha: `sha-${caminho}` }]))
    return {
        shaDoRamo: async () => 'commit-1',
        arvore: async () => arvore as never,
        blob: async (_r: string, sha: string) => arquivos[sha.replace('sha-', '')] ?? '',
        commits: async () => [],
        comparar: async () => ({ arquivos: [] }) as never,
    } as unknown as LeitorDoRepositorio
}

function extratorQueDevolve(dados: unknown): { ext: Extrator; pedidos: PedidoDeExtracao<unknown>[] } {
    const pedidos: PedidoDeExtracao<unknown>[] = []
    return {
        pedidos,
        ext: {
            async extrair(pedido) {
                pedidos.push(pedido as PedidoDeExtracao<unknown>)
                return { dados: dados as never, consumo: { passos: 1, tokensDeEntrada: 9_000, tokensDeSaida: 600 } }
            },
        },
    }
}

const BASE = {
    resumo: 'cliente diz que a recorrência semanal cria só o primeiro horário',
    repositorio: 'Venn360-Digital/venn-saas',
    commitSha: 'commit-1',
}

describe('diagnosticar', () => {
    it('lê os arquivos que o mapa aponta e devolve a hipótese', async () => {
        const leitor = leitorFalso({
            'core/agenda/recorrencia.ts': 'export function proximasDatas() { /* ... */ }',
            'core/agenda/feriados.ts': 'export const FERIADOS = []',
        })
        const { ext, pedidos } = extratorQueDevolve(DIAGNOSTICO)

        const r = await diagnosticar({
            ...BASE,
            candidatos: ['core/agenda/recorrencia.ts', 'core/agenda/feriados.ts'],
            leitor,
            extrator: ext,
        })

        expect(r.arquivosLidos).toBe(2)
        expect(r.diagnostico?.confianca).toBe('alta')
        /// O resumo do N1 entra na instrução, e o código vai como arquivo.
        expect(pedidos[0]?.instrucao).toContain('recorrência semanal cria só o primeiro')
        expect(pedidos[0]?.arquivos.map((a) => a.caminho)).toEqual([
            'core/agenda/recorrencia.ts',
            'core/agenda/feriados.ts',
        ])
    })

    it('descarta arquivo que o modelo citou e NÃO leu', async () => {
        /**
         * Não basta existir no repositório: o modelo não viu os outros, então
         * apontá-los é palpite com cara de leitura. Um diagnóstico que manda
         * alguém procurar onde não há custa mais que diagnóstico nenhum.
         */
        const leitor = leitorFalso({ 'core/agenda/recorrencia.ts': 'x' })
        const { ext } = extratorQueDevolve({
            ...DIAGNOSTICO,
            arquivosSuspeitos: [
                { caminho: 'core/agenda/recorrencia.ts', porque: 'o laço está aqui' },
                { caminho: 'core/agenda/inventado.ts', porque: 'parece relacionado' },
            ],
        })

        const r = await diagnosticar({ ...BASE, candidatos: ['core/agenda/recorrencia.ts'], leitor, extrator: ext })

        expect(r.descartados).toEqual(['core/agenda/inventado.ts'])
        /// E a hipótese sobrevive: item a item, como na base viva.
        expect(r.diagnostico?.arquivosSuspeitos).toHaveLength(1)
        expect(r.diagnostico?.hipotese).toContain('recorrência')
    })

    it('caminho que sumiu do commit não derruba os outros', async () => {
        /// O mapa técnico é derivado e pode estar um commit atrás. Um arquivo
        /// que sumiu é refatoração, não erro.
        const leitor = leitorFalso({ 'core/agenda/recorrencia.ts': 'x' })
        const { ext } = extratorQueDevolve(DIAGNOSTICO)

        const r = await diagnosticar({
            ...BASE,
            candidatos: ['core/agenda/apagado.ts', 'core/agenda/recorrencia.ts'],
            leitor,
            extrator: ext,
        })

        expect(r.arquivosLidos).toBe(1)
        expect(r.diagnostico).not.toBe(null)
    })

    it('para no teto de arquivos', async () => {
        const muitos: Record<string, string> = {}
        for (let i = 0; i < 30; i++) muitos[`core/a${i}.ts`] = 'x'
        const { ext, pedidos } = extratorQueDevolve(DIAGNOSTICO)

        const r = await diagnosticar({
            ...BASE,
            candidatos: Object.keys(muitos),
            leitor: leitorFalso(muitos),
            extrator: ext,
        })

        expect(r.arquivosLidos).toBe(TETO_DE_ARQUIVOS)
        expect(pedidos[0]?.arquivos).toHaveLength(TETO_DE_ARQUIVOS)
    })

    it('sem candidato, sem extrator e com falha do modelo devolvem motivo', async () => {
        const leitor = leitorFalso({ 'core/x.ts': 'x' })
        const { ext } = extratorQueDevolve(DIAGNOSTICO)

        expect((await diagnosticar({ ...BASE, candidatos: [], leitor, extrator: ext })).motivo).toBe('sem_arquivos')
        expect((await diagnosticar({ ...BASE, candidatos: ['core/x.ts'], leitor, extrator: null })).motivo).toBe(
            'sem_extrator'
        )

        const quebrado: Extrator = {
            async extrair() {
                throw new Error('modelo fora do ar')
            },
        }
        const r = await diagnosticar({ ...BASE, candidatos: ['core/x.ts'], leitor, extrator: quebrado })
        expect(r).toMatchObject({ motivo: 'falhou', diagnostico: null })
    })
})

describe('diagnosticoEmTexto', () => {
    it('diz que é automático e que não é correção', async () => {
        const leitor = leitorFalso({ 'core/agenda/recorrencia.ts': 'x' })
        const { ext } = extratorQueDevolve(DIAGNOSTICO)
        const r = await diagnosticar({ ...BASE, candidatos: ['core/agenda/recorrencia.ts'], leitor, extrator: ext })

        const texto = diagnosticoEmTexto(r)
        expect(texto).toContain('Hipótese (confiança alta)')
        expect(texto).toContain('core/agenda/recorrencia.ts')
        expect(texto).toContain('Como verificar')
        /// Quem lê precisa saber que ninguém corrigiu nada.
        expect(texto).toContain('não é correção')
    })

    it('sem diagnóstico, diz isso em uma linha', () => {
        expect(diagnosticoEmTexto({ diagnostico: null, descartados: [], consumo: { passos: 0, tokensDeEntrada: 0, tokensDeSaida: 0 }, arquivosLidos: 0 })).toContain(
            'Não foi possível'
        )
    })
})
