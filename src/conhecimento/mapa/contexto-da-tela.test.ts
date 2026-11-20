import { describe, expect, it } from 'vitest'

import { contextoDaTela, MAXIMO_DE_APOIO } from './contexto-da-tela.ts'
import type { IndiceTecnico, Tela } from './indice.ts'

const R = 'packages/core/src/'

const TELA: Tela = {
    rota: '/vendas/servicos',
    modulo: 'vendas',
    arquivos: [`${R}rotas/(dashboard)/vendas/servicos/page.tsx`, `${R}rotas/(dashboard)/vendas/servicos/ProcedimentosClient.tsx`],
    componentes: [`${R}components/products/ProductPanel`, `${R}components/shared/DataTable`, `${R}components/shared/IndexFrame`],
    apis: ['/api/products', '/api/products/:id'],
    modelos: ['productService'],
}

const INDICE = {
    commit: 'c1',
    telas: [TELA],
    apis: [
        { rota: '/api/products', modulo: 'vendas', arquivo: `${R}rotas/api/products/route.ts`, metodos: ['GET'], modelos: [], zod: true },
        { rota: '/api/products/:id', modulo: 'vendas', arquivo: `${R}rotas/api/products/[id]/route.ts`, metodos: ['PUT'], modelos: [], zod: true },
    ],
    arquivosPorModulo: {},
    analises: {},
} satisfies IndiceTecnico

const arvore = (extras: Record<string, number> = {}) =>
    new Map(
        Object.entries({
            [`${R}rotas/(dashboard)/vendas/servicos/page.tsx`]: 3_000,
            [`${R}rotas/(dashboard)/vendas/servicos/ProcedimentosClient.tsx`]: 25_000,
            [`${R}components/products/ProductPanel.tsx`]: 7_000,
            [`${R}components/shared/DataTable.tsx`]: 9_000,
            [`${R}components/shared/IndexFrame.tsx`]: 4_000,
            [`${R}rotas/api/products/route.ts`]: 5_700,
            [`${R}rotas/api/products/[id]/route.ts`]: 3_800,
            ...extras,
        }).map(([c, tamanho]) => [c, { sha: `sha-${c.length}`, tamanho }])
    )

describe('contextoDaTela', () => {
    it('leva a pasta da tela e, como apoio, o componente de domínio e os handlers', () => {
        const r = contextoDaTela(TELA, INDICE, arvore())
        const tela = r.filter((a) => a.papel === 'tela').map((a) => a.caminho)
        const apoio = r.filter((a) => a.papel === 'apoio').map((a) => a.caminho)

        expect(tela).toHaveLength(2)
        expect(apoio).toContain(`${R}components/products/ProductPanel.tsx`)
        expect(apoio).toContain(`${R}rotas/api/products/route.ts`)
        expect(apoio).toContain(`${R}rotas/api/products/[id]/route.ts`)
    })

    it('o chassi compartilhado fica FORA — são 10 mil linhas iguais em toda tela', () => {
        const r = contextoDaTela(TELA, INDICE, arvore())
        expect(r.some((a) => a.caminho.includes('/shared/'))).toBe(false)
    })

    it('resolve o componente sem extensão para o arquivo que existe', () => {
        const comIndex = contextoDaTela(
            { ...TELA, componentes: [`${R}components/products/Painel`] },
            INDICE,
            arvore({ [`${R}components/products/Painel/index.tsx`]: 2_000 })
        )
        expect(comIndex.map((a) => a.caminho)).toContain(`${R}components/products/Painel/index.tsx`)
    })

    it('arquivo que não está na árvore do commit é ignorado, não quebra', () => {
        const r = contextoDaTela({ ...TELA, apis: ['/api/sumiu'] }, INDICE, arvore())
        expect(r.every((a) => a.sha !== '')).toBe(true)
    })

    it('limita o apoio, dos menores para os maiores', () => {
        const muitos = Array.from({ length: 12 }, (_, i) => `${R}components/products/C${i}`)
        const tamanhos = Object.fromEntries(muitos.map((c, i) => [`${c}.tsx`, 1_000 * (12 - i)]))
        const r = contextoDaTela({ ...TELA, componentes: muitos }, INDICE, arvore(tamanhos))
        const apoio = r.filter((a) => a.papel === 'apoio')

        expect(apoio).toHaveLength(MAXIMO_DE_APOIO)
        /// Os menores entraram: C11 (1k) sim, C0 (12k) não.
        expect(apoio.map((a) => a.caminho)).toContain(`${R}components/products/C11.tsx`)
        expect(apoio.map((a) => a.caminho)).not.toContain(`${R}components/products/C0.tsx`)
    })

    it('não repete o mesmo arquivo em dois papéis', () => {
        const r = contextoDaTela(TELA, INDICE, arvore())
        expect(new Set(r.map((a) => a.caminho)).size).toBe(r.length)
    })
})
