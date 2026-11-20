import { describe, expect, it } from 'vitest'

import { extrairPapeis, type Papeis } from './papeis.ts'
import type { Extrator } from './com-modelo.ts'
import { renderizarPapeis } from '../renderizar/papeis.ts'
import { extrairVocabulario } from './vocabulario.ts'
import { fixture } from '../testes/fixtures.ts'

const HOOK = fixture('usePermissions.ts.txt')
const CTX = {
    app: { id: 'a', slug: 'odontobox', nome: 'Odontobox360', repositorio: 'o/r', pastaNoRepositorio: 'apps/odontobox360' },
    vocabulario: extrairVocabulario(fixture('brand-odontobox.ts.txt')),
    commit: 'a'.repeat(40),
    agora: new Date(),
}

const BOM: Papeis = {
    papeis: [
        { chave: 'OWNER', nome: 'proprietário' },
        { chave: 'ADMIN', nome: 'administrador' },
        { chave: 'GESTOR', nome: 'gestor' },
        { chave: 'ATENDENTE', nome: 'atendente' },
    ],
    capacidades: [
        { nome: 'Editar configurações da unidade', oQuePermite: 'Mudar ajustes e excluir registros operacionais.', papeis: ['OWNER', 'ADMIN', 'GESTOR'], evidencia: 'canEdit' },
        { nome: 'Transferir conversa', oQuePermite: 'Passar uma conversa para outra pessoa da equipe.', papeis: ['owner', 'admin'], evidencia: 'canTransfer' },
    ],
}

const extratorFalso = (dados: unknown): Extrator => ({
    async extrair(pedido) {
        return { dados: pedido.esquema.parse(dados), consumo: { passos: 1, tokensDeEntrada: 1_000, tokensDeSaida: 400 } }
    },
})

describe('extrairPapeis', () => {
    it('aceita rótulo em português com a flag como evidência', async () => {
        const r = await extrairPapeis(HOOK, extratorFalso(BOM))
        expect(r.dados.capacidades[0]?.nome).toBe('Editar configurações da unidade')
    })

    it('recusa rótulo que é nome de variável', async () => {
        /// Em produção (20/11/2026) a tabela saiu com "canEdit" e "canManage"
        /// como títulos de linha — o nome da flag passa pela ancoragem porque
        /// está no arquivo, e não diz nada a quem atende.
        const comFlag = { ...BOM, capacidades: [{ ...BOM.capacidades[0]!, nome: 'canEdit' }] }
        await expect(extrairPapeis(HOOK, extratorFalso(comFlag))).rejects.toThrow(/nome de variável/)
    })

    it('recusa quando NENHUMA capacidade casa com os papéis: a tabela sairia vazia', async () => {
        /// Dizer que ninguém pode nada é pior que não ter o artigo.
        const semCruzar = {
            ...BOM,
            capacidades: [{ ...BOM.capacidades[0]!, papeis: ['proprietário', 'administrador'] }],
        }
        await expect(extrairPapeis(HOOK, extratorFalso(semCruzar))).rejects.toThrow(/nenhuma capacidade casa/)
    })

    it('flag inventada reprova', async () => {
        const inventada = { ...BOM, capacidades: [{ ...BOM.capacidades[0]!, evidencia: 'canApproveInvoices' }] }
        await expect(extrairPapeis(HOOK, extratorFalso(inventada))).rejects.toThrow(/não existem no arquivo/)
    })
})

describe('renderizarPapeis', () => {
    it('a tabela marca "sim" mesmo quando o modelo troca a caixa da chave', () => {
        const [artigo] = renderizarPapeis(BOM, CTX)
        const linhaTransferir = artigo?.corpo.split('\n').find((l) => l.startsWith('| Transferir conversa'))

        expect(linhaTransferir).toContain('sim')
        expect(artigo?.corpo).toContain('| Editar configurações da unidade | sim | sim | sim | — |')
    })

    it('a evidência não vai para o corpo: é nome de variável', () => {
        const [artigo] = renderizarPapeis(BOM, CTX)
        expect(artigo?.corpo).not.toContain('canEdit')
    })
})
