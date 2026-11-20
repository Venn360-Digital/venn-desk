import { describe, expect, it } from 'vitest'

import { resumirConsultas, type ConsultaRegistrada } from './consultas.ts'

const em = (iso: string) => new Date(iso)

const consulta = (dados: Partial<ConsultaRegistrada> = {}): ConsultaRegistrada => ({
    texto: 'como exporto os contatos',
    artigosDevolvidos: [],
    artigoLidoId: null,
    criadoEm: em('2026-11-19T10:00:00Z'),
    ...dados,
})

describe('resumirConsultas', () => {
    it('agrupa a MESMA lacuna escrita de três jeitos', () => {
        /**
         * O defeito que isto impede: três linhas separadas para uma lacuna só,
         * que faria a dúvida mais comum parecer três raras — e quem escreve
         * começaria pela errada.
         */
        const r = resumirConsultas([
            consulta({ texto: 'não consigo exportar contatos' }),
            consulta({ texto: 'exportar lista de contatos', criadoEm: em('2026-11-19T11:00:00Z') }),
            consulta({ texto: 'como exporto os contatos', criadoEm: em('2026-11-19T12:00:00Z') }),
            consulta({ texto: 'agenda do profissional novo não aparece' }),
        ])

        expect(r.semResposta).toBe(4)
        expect(r.lacunas).toHaveLength(2)
        expect(r.lacunas[0]).toMatchObject({
            exemplo: 'não consigo exportar contatos',
            vezes: 3,
            ultimaEm: em('2026-11-19T12:00:00Z'),
        })
    })

    it('o exemplo é como alguém ESCREVEU, não uma média de palavras', () => {
        const r = resumirConsultas([
            consulta({ texto: 'Não consigo exportar os contatos!!' }),
            consulta({ texto: 'exportar contatos' }),
        ])
        expect(r.lacunas[0]?.exemplo).toBe('Não consigo exportar os contatos!!')
    })

    it('consulta que voltou artigo não é lacuna', () => {
        const r = resumirConsultas([
            consulta({ artigosDevolvidos: ['a1'] }),
            consulta({ artigosDevolvidos: ['a1'], artigoLidoId: 'a1' }),
        ])
        expect(r.semResposta).toBe(0)
        expect(r.lacunas).toEqual([])
    })

    it('conta leitura INTEIRA por artigo, não devolução na busca', () => {
        /// Ser devolvido numa lista de cinco não é ser usado. Lido é usado.
        const r = resumirConsultas([
            consulta({ artigosDevolvidos: ['a1', 'a2'], artigoLidoId: 'a1' }),
            consulta({ artigosDevolvidos: ['a1', 'a2'], artigoLidoId: 'a1' }),
            consulta({ artigosDevolvidos: ['a1', 'a2'] }),
        ])
        expect(r.leiturasPorArtigo).toEqual({ a1: 2 })
    })

    it('texto só de palavras vazias não se agrupa com nada', () => {
        const r = resumirConsultas([consulta({ texto: 'o a de' }), consulta({ texto: 'o a de' })])
        expect(r.lacunas).toHaveLength(2)
    })

    it('ordena as lacunas da mais frequente à menos', () => {
        const r = resumirConsultas([
            consulta({ texto: 'relatório de faturamento' }),
            consulta({ texto: 'senha bloqueada' }),
            consulta({ texto: 'minha senha está bloqueada' }),
        ])
        expect(r.lacunas.map((l) => l.vezes)).toEqual([2, 1])
    })
})
