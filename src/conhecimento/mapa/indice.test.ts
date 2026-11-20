import { describe, expect, it } from 'vitest'

import { fixture } from '../testes/fixtures.ts'
import { analisarArquivo, arquivosDoMapa, montarIndice, normalizarRotaDeApi, rotaDaApi, rotaDaPagina } from './indice.ts'
import { moduloDe } from './modulos.ts'

const ARQUIVOS: Record<string, string> = {
    'packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx': fixture('modulo-vendas/_dashboard__vendas_servicos_page.tsx.txt'),
    'packages/core/src/rotas/(dashboard)/vendas/servicos/ProcedimentosClient.tsx': fixture('modulo-vendas/_dashboard__vendas_servicos_ProcedimentosClient.tsx.txt'),
    'packages/core/src/rotas/(dashboard)/vendas/servicos/dados.ts': fixture('modulo-vendas/_dashboard__vendas_servicos_dados.ts.txt'),
    'packages/core/src/rotas/api/products/route.ts': fixture('modulo-vendas/api_products_route.ts.txt'),
    'packages/core/src/rotas/api/products/[id]/route.ts': fixture('modulo-vendas/api_products__id__route.ts.txt'),
    /// Fora de todo módulo: nunca entra.
    'packages/core/src/rotas/(dashboard)/plataforma/page.tsx': "import prisma from '@venn/db/cliente'\nprisma.account.findMany()",
    'packages/core/src/rotas/api/products/route.test.ts': 'teste',
    'docs/re-respond-io/inventory/features.md': '# concorrente',
}

function arvore() {
    return new Map(Object.entries(ARQUIVOS).map(([c, t]) => [c, { sha: `sha-${t.length}`, tamanho: t.length }]))
}

describe('rotas a partir do caminho', () => {
    it('tira os grupos entre parênteses e o page.tsx', () => {
        expect(rotaDaPagina('packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx')).toBe('/vendas/servicos')
        expect(rotaDaPagina('packages/core/src/rotas/(auth)/login/page.tsx')).toBe('/login')
        expect(rotaDaPagina('packages/core/src/rotas/page.tsx')).toBe('/')
        expect(rotaDaPagina('packages/core/src/rotas/x/layout.tsx')).toBeNull()
    })

    it('normaliza parâmetro dinâmico e querystring da API', () => {
        expect(rotaDaApi('packages/core/src/rotas/api/products/[id]/route.ts')).toBe('/api/products/:id')
        expect(normalizarRotaDeApi('/api/products/${editingId}')).toBe('/api/products/:id')
        expect(normalizarRotaDeApi('/api/products?${params}')).toBe('/api/products')
    })
})

describe('analisarArquivo', () => {
    it('acha componentes, APIs e modelos no client real de Procedimentos', () => {
        const a = analisarArquivo(
            'packages/core/src/rotas/(dashboard)/vendas/servicos/ProcedimentosClient.tsx',
            ARQUIVOS['packages/core/src/rotas/(dashboard)/vendas/servicos/ProcedimentosClient.tsx'] ?? '',
            'x'
        )
        expect(a.componentes).toContain('packages/core/src/components/products/ProductPanel')
        expect(a.apis).toEqual(['/api/products', '/api/products/:id'])
        expect(a.metodos).toEqual([])
    })

    it('no handler, lê métodos exportados, modelo do Prisma e Zod', () => {
        const a = analisarArquivo('packages/core/src/rotas/api/products/route.ts', ARQUIVOS['packages/core/src/rotas/api/products/route.ts'] ?? '', 'x')
        expect(a.metodos).toEqual(['GET', 'POST'])
        expect(a.modelos).toEqual(['productService'])
        expect(a.zod).toBe(true)
    })
})

describe('montarIndice', () => {
    it('monta a tela de Procedimentos com os irmãos, as APIs e as tabelas', async () => {
        const lidos: string[] = []
        const { indice } = await montarIndice({
            commit: 'c1',
            arvore: arvore(),
            ler: async (caminho) => {
                lidos.push(caminho)
                return ARQUIVOS[caminho] ?? ''
            },
        })

        const tela = indice.telas.find((t) => t.rota === '/vendas/servicos')
        expect(tela?.modulo).toBe('vendas')
        expect(tela?.arquivos).toHaveLength(3)
        expect(tela?.apis).toEqual(['/api/products', '/api/products/:id'])
        expect(tela?.modelos).toContain('productService')

        const api = indice.apis.find((a) => a.rota === '/api/products')
        expect(api?.metodos).toEqual(['GET', 'POST'])
        expect(api?.modulo).toBe('vendas')

        /// `plataforma/`, teste e docs/ ficam fora: nem lidos.
        expect(lidos.some((c) => c.includes('plataforma') || c.includes('.test.') || c.startsWith('docs/'))).toBe(false)
        expect(indice.arquivosPorModulo['vendas']).toHaveLength(5)
    })

    it('reaproveita a análise de blob igual e só lê o que mudou', async () => {
        const primeira = await montarIndice({ commit: 'c1', arvore: arvore(), ler: async (c) => ARQUIVOS[c] ?? '' })

        const nova = arvore()
        const caminho = 'packages/core/src/rotas/api/products/route.ts'
        nova.set(caminho, { sha: 'mudou', tamanho: 10 })

        const lidos: string[] = []
        const { indice, lidos: quantos } = await montarIndice({
            commit: 'c2',
            arvore: nova,
            anterior: primeira.indice,
            ler: async (c) => {
                lidos.push(c)
                return 'export async function DELETE() {}'
            },
        })

        expect(quantos).toBe(1)
        expect(lidos).toEqual([caminho])
        expect(indice.apis.find((a) => a.rota === '/api/products')?.metodos).toEqual(['DELETE'])
        /// A análise antiga dos outros continua lá, com o sha antigo.
        expect(indice.analises['packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx']?.sha).toBe(
            primeira.indice.analises['packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx']?.sha
        )
    })
})

describe('moduloDe', () => {
    it('o prefixo mais longo vence: departamentos é de atendimento, não de vendas', () => {
        expect(moduloDe('packages/core/src/rotas/(dashboard)/vendas/departamentos/page.tsx')?.slug).toBe('atendimento')
        expect(moduloDe('packages/core/src/rotas/(dashboard)/vendas/negocios/page.tsx')?.slug).toBe('vendas')
    })

    it('plataforma e o que está fora do core não têm módulo', () => {
        expect(moduloDe('packages/core/src/rotas/(dashboard)/plataforma/page.tsx')).toBeNull()
        expect(moduloDe('apps/odontobox360/src/app/(dashboard)/suporte/page.tsx')).toBeNull()
        expect(moduloDe('docs/re-respond-io/x.md')).toBeNull()
    })

    it('arquivosDoMapa filtra teste, tamanho e quem não tem módulo', () => {
        const lista = arquivosDoMapa(arvore())
        expect(lista).toHaveLength(5)
    })
})
