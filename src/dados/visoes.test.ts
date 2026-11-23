import { describe, expect, it } from 'vitest'

import { conexaoFalsa } from './testes/conexao-falsa.ts'
import { criarVisao, esquemaDosFiltros, excluirVisao, listarVisoes } from './visoes.ts'

describe('esquemaDosFiltros', () => {
    it('aceita os filtros da fila e RECUSA chave desconhecida', () => {
        /**
         * `strict` porque uma chave desconhecida salva aqui viraria parâmetro
         * ignorado na query: a visão abriria a fila inteira e pareceria que o
         * filtro deixou de funcionar.
         */
        expect(esquemaDosFiltros.safeParse({ app: 'odontobox', sla: 'estourado' }).success).toBe(true)
        expect(esquemaDosFiltros.safeParse({ prioridadee: 'ALTA' }).success).toBe(false)
        expect(esquemaDosFiltros.safeParse({ sla: 'qualquer' }).success).toBe(false)
    })
})

describe('listarVisoes', () => {
    it('traz as do time e as minhas, nunca as de outro', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'visaoSalva.findMany': [
                { id: 'v1', nome: 'Urgentes', filtros: { prioridade: 'URGENTE' }, agenteId: null },
                { id: 'v2', nome: 'Minhas', filtros: { app: 'conecta' }, agenteId: 'ag-1' },
            ],
        })

        const visoes = await listarVisoes(conexao as never, 'ag-1')

        expect(visoes.map((v) => v.doTime)).toEqual([true, false])
        /// O filtro de dono vai no `where`: sem ele, a visão pessoal de outra
        /// pessoa apareceria na lista de todos.
        const onde = JSON.stringify(chamadas[0]?.args)
        expect(onde).toContain('ag-1')
        expect(onde).toContain('excluidoEm')
    })

    it('visão com filtro inválido é omitida, não quebra a lista', async () => {
        /// O esquema pode ter mudado desde que ela foi salva.
        const { conexao } = conexaoFalsa({
            'visaoSalva.findMany': [
                { id: 'v1', nome: 'Velha', filtros: { campoQueNaoExiste: 'x' }, agenteId: null },
                { id: 'v2', nome: 'Boa', filtros: { app: 'odontobox' }, agenteId: null },
            ],
        })

        const visoes = await listarVisoes(conexao as never, 'ag-1')
        expect(visoes.map((v) => v.nome)).toEqual(['Boa'])
    })
})

describe('excluirVisao', () => {
    const quem = { agenteId: 'ag-1', podeMexerNoTime: false }

    it('a pessoa apaga a dela', async () => {
        const { conexao } = conexaoFalsa({
            'visaoSalva.findFirst': { id: 'v1', agenteId: 'ag-1' },
            'visaoSalva.updateMany': { count: 1 },
        })
        expect(await excluirVisao(conexao as never, 'v1', quem, new Date())).toBe(true)
    })

    it('NÃO apaga a de outro, mesmo sabendo o id', async () => {
        /// Sem esta checagem, qualquer agente apagaria a visão pessoal de outro
        /// com uma chamada direta à API.
        const { conexao, chamadas } = conexaoFalsa({ 'visaoSalva.findFirst': { id: 'v1', agenteId: 'ag-9' } })

        expect(await excluirVisao(conexao as never, 'v1', quem, new Date())).toBe(false)
        expect(chamadas.some((c) => c.metodo === 'updateMany')).toBe(false)
    })

    it('a do time só sai para quem pode mexer nela', async () => {
        const doTime = { 'visaoSalva.findFirst': { id: 'v1', agenteId: null }, 'visaoSalva.updateMany': { count: 1 } }

        expect(await excluirVisao(conexaoFalsa(doTime).conexao as never, 'v1', quem, new Date())).toBe(false)
        expect(
            await excluirVisao(
                conexaoFalsa(doTime).conexao as never,
                'v1',
                { agenteId: 'ag-1', podeMexerNoTime: true },
                new Date()
            )
        ).toBe(true)
    })

    it('visão que não existe devolve falso, sem escrever', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'visaoSalva.findFirst': null })
        expect(await excluirVisao(conexao as never, 'v1', quem, new Date())).toBe(false)
        expect(chamadas.some((c) => c.metodo === 'updateMany')).toBe(false)
    })
})

describe('criarVisao', () => {
    it('visão pessoal grava o dono; a do time não', async () => {
        const pessoal = conexaoFalsa({ 'visaoSalva.create': { id: 'v1' } })
        await criarVisao(pessoal.conexao as never, { nome: 'Minhas', filtros: { app: 'x' }, agenteId: 'ag-1' })
        expect(JSON.stringify(pessoal.chamadas[0]?.args)).toContain('ag-1')

        const doTime = conexaoFalsa({ 'visaoSalva.create': { id: 'v2' } })
        await criarVisao(doTime.conexao as never, { nome: 'Urgentes', filtros: { sla: 'estourado' }, agenteId: null })
        expect(JSON.stringify(doTime.chamadas[0]?.args)).not.toContain('agenteId')
    })
})
