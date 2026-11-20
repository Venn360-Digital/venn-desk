import { describe, expect, it } from 'vitest'

import { extrairNovidades, juntarNovidades, type Novidades } from './novidades.ts'
import type { Extrator } from './com-modelo.ts'
import type { Commit } from '../github.ts'

const COMMITS: Commit[] = [
    { sha: 'a'.repeat(40), data: '2026-11-19T10:00:00Z', assunto: 'fix(suporte): a pílula SUPORTE ficava em cima do botão Enviar', corpo: '' },
    { sha: 'b'.repeat(40), data: '2026-11-18T10:00:00Z', assunto: 'feat(conversas): dá para editar e apagar mensagem enviada', corpo: '' },
    { sha: 'c'.repeat(40), data: '2026-11-17T10:00:00Z', assunto: 'chore(ci): portão de verificação no Worker', corpo: '' },
]

const item = (sha: string, dados: Partial<Novidades['itens'][number]> = {}) => ({
    sha: sha.slice(0, 7),
    data: '2026-11-19',
    tipo: 'correcao' as const,
    titulo: 'O selo de suporte não cobre mais o botão de enviar',
    descricao: 'Na conversa, o atalho de suporte saiu de cima do botão Enviar.',
    publico: true,
    ...dados,
})

function extratorFalso(dados: unknown, registro?: { arquivos?: { caminho: string }[] }) {
    const ext: Extrator = {
        async extrair(pedido) {
            if (registro !== undefined) registro.arquivos = pedido.arquivos
            return { dados: pedido.esquema.parse(dados), consumo: { passos: 1, tokensDeEntrada: 900, tokensDeSaida: 300 } }
        },
    }
    return ext
}

describe('extrairNovidades', () => {
    it('manda cada commit como um arquivo rotulado, e devolve os itens', async () => {
        const registro: { arquivos?: { caminho: string }[] } = {}
        const r = await extrairNovidades(COMMITS, extratorFalso({ itens: [item('a'.repeat(40))] }, registro))

        expect(registro.arquivos).toHaveLength(3)
        expect(registro.arquivos?.[0]?.caminho).toContain('commit aaaaaaa')
        expect(r.dados.itens[0]?.titulo).toContain('selo de suporte')
    })

    it('sem commit não chama o modelo', async () => {
        let chamou = false
        const r = await extrairNovidades([], {
            async extrair() {
                chamou = true
                throw new Error('não deveria')
            },
        })
        expect(chamou).toBe(false)
        expect(r.dados.itens).toEqual([])
    })

    it('item público com URL, arquivo ou sha no texto reprova a fonte', async () => {
        /// Uma novidade é uma frase sobre o produto, não um recibo de commit.
        for (const texto of ['Veja em https://github.com/x', 'Corrigido em Topbar.tsx', 'O commit a1b2c3d resolveu']) {
            const dados = { itens: [item('a'.repeat(40), { descricao: `${texto} e agora funciona bem.` })] }
            await expect(extrairNovidades(COMMITS, extratorFalso(dados))).rejects.toThrow(/detalhe interno/)
        }
    })

    it('item NÃO público pode falar o que quiser: ele não vai para o artigo', async () => {
        const dados = { itens: [item('c'.repeat(40), { publico: false, motivoDeOmitir: 'portão de CI', descricao: 'Mexeu em ci-worker.mjs apenas.' })] }
        await expect(extrairNovidades(COMMITS, extratorFalso(dados))).resolves.toBeDefined()
    })

    it('sha que não foi pedido reprova: o modelo não inventa commit', async () => {
        const dados = { itens: [item('9'.repeat(40))] }
        await expect(extrairNovidades(COMMITS, extratorFalso(dados))).rejects.toThrow(/não foram pedidos/)
    })
})

describe('juntarNovidades', () => {
    const agora = new Date('2026-11-20T12:00:00Z')

    it('acrescenta os novos aos antigos, do mais recente ao mais antigo', () => {
        const antes = [{ sha: 'zzzzzzz', data: '2026-11-10', tipo: 'novo' as const, titulo: 'Algo antigo', descricao: 'Uma coisa.' }]
        const r = juntarNovidades([item('a'.repeat(40))], antes, agora)

        expect(r.map((i) => i.data)).toEqual(['2026-11-19', '2026-11-10'])
        expect(r[0]).not.toHaveProperty('publico')
    })

    it('descarta o que não é público', () => {
        const r = juntarNovidades([item('a'.repeat(40), { publico: false })], [], agora)
        expect(r).toEqual([])
    })

    it('corta o que passou da janela de 90 dias', () => {
        const velho = [{ sha: 'yyyyyyy', data: '2026-06-01', tipo: 'novo' as const, titulo: 'Muito antigo', descricao: 'x.' }]
        expect(juntarNovidades([], velho, agora)).toEqual([])
    })

    it('o mesmo commit não entra duas vezes', () => {
        const antes = [{ sha: 'aaaaaaa', data: '2026-11-19', tipo: 'correcao' as const, titulo: 'Versão antiga do texto', descricao: 'x.' }]
        const r = juntarNovidades([item('a'.repeat(40))], antes, agora)

        expect(r).toHaveLength(1)
        /// O texto novo vence: ele saiu da leitura mais recente.
        expect(r[0]?.titulo).toContain('selo de suporte')
    })
})
