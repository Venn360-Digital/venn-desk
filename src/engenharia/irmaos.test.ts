import { describe, expect, it } from 'vitest'

import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import { espelharNosIrmaos, tocaOCompartilhado } from './irmaos.ts'

const MONO = 'Venn360-Digital/venn-saas'
const ORIGEM = { id: 'app-1', slug: 'odontobox', repositorio: MONO }

const TRES = [
    { id: 'app-1', slug: 'odontobox', repositorio: MONO, pastaNoRepositorio: 'apps/odontobox360', excluidoEm: null },
    { id: 'app-2', slug: 'conecta', repositorio: MONO, pastaNoRepositorio: 'apps/conecta360', excluidoEm: null },
    { id: 'app-3', slug: 'stagent', repositorio: MONO, pastaNoRepositorio: 'apps/stagent360', excluidoEm: null },
]

describe('tocaOCompartilhado', () => {
    it('distingue o core do que é de um app só', () => {
        expect(tocaOCompartilhado(['packages/core/src/agenda/data.ts'])).toBe(true)
        expect(tocaOCompartilhado(['apps/odontobox360/src/app/page.tsx'])).toBe(false)
        expect(tocaOCompartilhado([])).toBe(false)
    })
})

describe('espelharNosIrmaos', () => {
    const base = {
        appDeOrigem: ORIGEM,
        numeroDeOrigem: 'ODB-1042',
        titulo: 'recorrência para no feriado',
    }

    it('espelha nos DOIS irmãos quando o defeito é do core', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'app.findMany': TRES,
            'problem.findFirst': null,
            'problem.create': { id: 'pb-novo', titulo: 'x' },
        })

        const espelhos = await espelharNosIrmaos({
            ...base,
            cliente: conexao as never,
            caminhos: ['packages/core/src/agenda/recorrencia.ts'],
        })

        expect(espelhos.map((e) => e.app)).toEqual(['conecta', 'stagent'])
        expect(espelhos.every((e) => e.criado)).toBe(true)

        /// A causa diz de onde veio: sem isso, o gestor do Conecta veria um
        /// defeito que ninguém relatou e não saberia por quê.
        const criado = chamadas.find((c) => c.delegado === 'problem' && c.metodo === 'create')
        expect(String((criado?.args.data as { causa: string }).causa)).toContain('ODB-1042')
        expect(String((criado?.args.data as { titulo: string }).titulo)).toContain('mesmo defeito de ODB-1042')
    })

    it('NÃO espelha defeito que é de um app só', async () => {
        /// Arquivo em `apps/<app>/` não afeta ninguém mais, e criar defeito nos
        /// irmãos por isso encheria o Console de trabalho inexistente.
        const { conexao, chamadas } = conexaoFalsa({ 'app.findMany': TRES })

        expect(
            await espelharNosIrmaos({
                ...base,
                cliente: conexao as never,
                caminhos: ['apps/odontobox360/src/app/(dashboard)/agenda/page.tsx'],
            })
        ).toEqual([])
        expect(chamadas).toHaveLength(0)
    })

    it('o segundo diagnóstico do mesmo defeito não cria segundo espelho', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'app.findMany': TRES,
            'problem.findFirst': { id: 'pb-ja', titulo: 'recorrência para no feriado (mesmo defeito de ODB-1042)' },
        })

        const espelhos = await espelharNosIrmaos({
            ...base,
            cliente: conexao as never,
            caminhos: ['packages/core/src/agenda/recorrencia.ts'],
        })

        expect(espelhos.every((e) => !e.criado)).toBe(true)
        expect(chamadas.some((c) => c.metodo === 'create')).toBe(false)
    })

    it('app sem repositório cadastrado não espelha nada', async () => {
        const { conexao } = conexaoFalsa({ 'app.findMany': TRES })
        expect(
            await espelharNosIrmaos({
                ...base,
                appDeOrigem: { ...ORIGEM, repositorio: null },
                cliente: conexao as never,
                caminhos: ['packages/core/src/x.ts'],
            })
        ).toEqual([])
    })

    it('app de outro repositório não é irmão', async () => {
        /// A Fase 8 prevê app novo; se ele vier de outro monorepo, o core não é
        /// o mesmo e o defeito não é compartilhado.
        const { conexao } = conexaoFalsa({
            'app.findMany': [...TRES, { id: 'app-4', slug: 'outro', repositorio: 'Venn360-Digital/outro', pastaNoRepositorio: 'apps/x', excluidoEm: null }],
            'problem.findFirst': null,
            'problem.create': { id: 'pb-novo' },
        })

        const espelhos = await espelharNosIrmaos({
            ...base,
            cliente: conexao as never,
            caminhos: ['packages/core/src/x.ts'],
        })

        expect(espelhos.map((e) => e.app)).toEqual(['conecta', 'stagent'])
    })
})
