import { describe, expect, it } from 'vitest'

import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import { rodarRetencao } from './rodar.ts'

const AGORA = new Date('2026-11-23T03:00:00Z')
const APP = { id: 'app-1', slug: 'odontobox', excluidoEm: null }

function bucketFalso(falhaEm: string[] = []) {
    const apagadas: string[] = []
    return {
        apagadas,
        bucket: {
            delete: async (chave: string) => {
                if (falhaEm.includes(chave)) throw new Error('R2 recusou')
                apagadas.push(chave)
            },
        },
    }
}

const VELHOS = [
    { id: 'a1', chave: 'app-1/t1/foto.png', criadoEm: new Date('2024-01-01') },
    { id: 'a2', chave: 'app-1/t1/doc.pdf', criadoEm: new Date('2024-02-01') },
]

describe('rodarRetencao', () => {
    it('apaga do R2 e marca a linha, nessa ordem', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'app.findMany': [APP], 'attachment.findMany': VELHOS })
        const { bucket, apagadas } = bucketFalso()

        const r = await rodarRetencao(conexao as never, { agora: AGORA, bucket })

        expect(r).toEqual([{ app: 'odontobox', expurgados: 2, falhas: 0 }])
        expect(apagadas).toEqual(['app-1/t1/foto.png', 'app-1/t1/doc.pdf'])
        expect(chamadas.filter((c) => c.delegado === 'attachment' && c.metodo === 'updateMany')).toHaveLength(2)
    })

    it('falha no R2 NÃO marca a linha', async () => {
        /**
         * Marcar primeiro e falhar no R2 deixaria o arquivo lá para sempre, com
         * a linha dizendo que ele saiu — o pior dos dois mundos, porque ninguém
         * voltaria a olhar.
         */
        const { conexao, chamadas } = conexaoFalsa({ 'app.findMany': [APP], 'attachment.findMany': VELHOS })
        const { bucket } = bucketFalso(['app-1/t1/foto.png'])

        const r = await rodarRetencao(conexao as never, { agora: AGORA, bucket })

        expect(r).toEqual([{ app: 'odontobox', expurgados: 1, falhas: 1 }])
        expect(chamadas.filter((c) => c.delegado === 'attachment' && c.metodo === 'updateMany')).toHaveLength(1)
    })

    it('sem bucket, NÃO roda', async () => {
        /// Marcar sem apagar mentiria: a linha diria que o arquivo saiu e ele
        /// continuaria lá.
        const { conexao, chamadas } = conexaoFalsa({ 'app.findMany': [APP], 'attachment.findMany': VELHOS })
        expect(await rodarRetencao(conexao as never, { agora: AGORA, bucket: undefined })).toEqual([])
        expect(chamadas).toHaveLength(0)
    })

    it('o limite da consulta é 12 meses atrás', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'app.findMany': [APP], 'attachment.findMany': [] })
        await rodarRetencao(conexao as never, { agora: AGORA, bucket: bucketFalso().bucket })

        const consulta = chamadas.find((c) => c.delegado === 'attachment' && c.metodo === 'findMany')
        const onde = JSON.stringify(consulta?.args)
        expect(onde).toContain('2025-11-23')
        /// E só o que ainda não saiu: sem isto a varredura releria os mesmos
        /// arquivos todos os dias.
        expect(onde).toContain('expurgadoEm')
    })

    it('app sem anexo velho não aparece no resultado', async () => {
        const { conexao } = conexaoFalsa({ 'app.findMany': [APP], 'attachment.findMany': [] })
        expect(await rodarRetencao(conexao as never, { agora: AGORA, bucket: bucketFalso().bucket })).toEqual([])
    })
})
