import { describe, expect, it } from 'vitest'

import { textoDoResumoDiario } from './resumo-diario.ts'

const LINHA = { app: 'odontobox', abertos: 4, resolvidos: 3, violados: 1, emAberto: 6 }

describe('textoDoResumoDiario', () => {
    it('diz quanto entrou, quanto saiu, o que furou e o que ficou', () => {
        const texto = textoDoResumoDiario({ linhas: [LINHA], gastoUsd: 1.37, horas: 24 })
        expect(texto).toContain('*odontobox*')
        expect(texto).toContain('4 aberto(s)')
        expect(texto).toContain('3 resolvido(s)')
        expect(texto).toContain('1 fora do prazo')
        expect(texto).toContain('6 na fila agora')
        expect(texto).toContain('IA: US$ 1.37')
    })

    it('omite o que é zero, menos o custo', () => {
        /**
         * O custo entra sempre: é o número que ninguém olha até doer, e vê-lo
         * todo dia é o que faz um dia de US$ 229 ser notado no dia.
         */
        const texto = textoDoResumoDiario({
            linhas: [{ app: 'conecta', abertos: 1, resolvidos: 0, violados: 0, emAberto: 0 }],
            gastoUsd: 0,
            horas: 24,
        })
        expect(texto).toContain('1 aberto(s)')
        expect(texto).not.toContain('fora do prazo')
        expect(texto).not.toContain('na fila agora')
        expect(texto).toContain('IA: US$ 0.00')
    })

    it('dia sem movimento nenhum NÃO gera resumo', () => {
        /// Um resumo "0 chamados, US$ 0,00" todas as manhãs é a maneira mais
        /// eficiente de ninguém ler o resumo do dia em que houve algo.
        expect(
            textoDoResumoDiario({
                linhas: [{ app: 'stagent', abertos: 0, resolvidos: 0, violados: 0, emAberto: 0 }],
                gastoUsd: 0,
                horas: 24,
            })
        ).toBe(null)
    })

    it('app parado desaparece da lista, mas app com fila aparece', () => {
        const texto = textoDoResumoDiario({
            linhas: [
                { app: 'odontobox', abertos: 2, resolvidos: 0, violados: 0, emAberto: 0 },
                { app: 'conecta', abertos: 0, resolvidos: 0, violados: 0, emAberto: 0 },
                { app: 'stagent', abertos: 0, resolvidos: 0, violados: 0, emAberto: 3 },
            ],
            gastoUsd: 0.5,
            horas: 24,
        })

        expect(texto).toContain('odontobox')
        expect(texto).not.toContain('conecta')
        expect(texto).toContain('stagent')
    })
})
