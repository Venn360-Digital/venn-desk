import { describe, expect, it } from 'vitest'

import { escopoDoApp } from '../dados/escopo.ts'
import { conexaoFalsa, type Chamada } from '../dados/testes/conexao-falsa.ts'
import { documentarTela, VERSAO_DO_EXTRATOR_DE_TELA } from './documentar.ts'
import type { Extrator } from './extrair/com-modelo.ts'
import type { Tela } from './extrair/tela.ts'
import type { LeitorDoRepositorio } from './github.ts'
import { fixture } from './testes/fixtures.ts'

const BRAND = { odontobox: fixture('brand-odontobox.ts.txt'), conecta: fixture('brand-conecta.ts.txt') }
const CLIENT = '<h1>{v.Servicos}</h1> <button>Novo</button> Item criado · Item excluído'

const APPS = [
    { id: 'app-odo', slug: 'odontobox', nome: 'Odontobox360', repositorio: 'o/r', pastaNoRepositorio: 'apps/odontobox360' },
    { id: 'app-con', slug: 'conecta', nome: 'Conecta360', repositorio: 'o/r', pastaNoRepositorio: 'apps/conecta360' },
]

const SHA = 'f'.repeat(40)
const ARQUIVOS = [{ caminho: 'packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx', sha: 'sha-tela', papel: 'tela' as const }]

const TELA: Tela = {
    nome: '{{Servicos}}',
    paraQueServe: 'Lista o catálogo de itens que a organização oferece.',
    oQueSeVe: ['Novo'],
    acoes: [{ nome: 'Novo', oQueFaz: 'Abre o painel de cadastro.', evidencia: 'Item criado' }],
    campos: [],
    avisos: [{ quando: 'ao excluir', texto: 'Item excluído' }],
    porQuePodeNaoAparecer: [],
}

const MENU = { segmentos: { vendas: 'Vendas', servicos: '{{Servicos}}' }, secoes: [{ rotulo: 'a' }, { rotulo: 'b' }, { rotulo: 'c' }] }

function leitorFalso() {
    const lidos: string[] = []
    const leitor: LeitorDoRepositorio = {
        async shaDoRamo() {
            return SHA
        },
        async arvore() {
            return new Map([
                ['apps/odontobox360/src/config/brand.ts', { sha: 'sha-odo', tamanho: 1 }],
                ['apps/conecta360/src/config/brand.ts', { sha: 'sha-con', tamanho: 1 }],
            ])
        },
        async blob(_r, sha) {
            lidos.push(sha)
            if (sha === 'sha-odo') return BRAND.odontobox
            if (sha === 'sha-con') return BRAND.conecta
            return CLIENT
        },
        async commits() {
            return []
        },
        async comparar() {
            return []
        },
    }
    return { leitor, lidos }
}

function extratorFalso() {
    let chamadas = 0
    const ext: Extrator = {
        async extrair(pedido) {
            chamadas++
            return { dados: pedido.esquema.parse(TELA), consumo: { passos: 1, tokensDeEntrada: 20_000, tokensDeSaida: 1_000 } }
        },
    }
    return { ext, quantas: () => chamadas }
}

/** Um escopo por app, cada um com a própria conexão falsa. */
function escopos(respostasPorApp: Record<string, Record<string, unknown>> = {}) {
    const conexoes = new Map<string, { conexao: ReturnType<typeof conexaoFalsa>['conexao']; chamadas: Chamada[] }>()
    for (const app of APPS) conexoes.set(app.id, conexaoFalsa({ 'kbArticle.findFirst': null, ...(respostasPorApp[app.id] ?? {}) }))
    return {
        escopoDe: (appId: string) => escopoDoApp(conexoes.get(appId)!.conexao, appId),
        chamadasDe: (appId: string) => conexoes.get(appId)!.chamadas,
    }
}

const base = (extras: Partial<Parameters<typeof documentarTela>[0]> = {}) => {
    const { leitor } = leitorFalso()
    const { ext } = extratorFalso()
    const e = escopos()
    return {
        rota: '/vendas/servicos',
        arquivos: ARQUIVOS,
        commitSha: SHA,
        apps: APPS,
        escopoDe: e.escopoDe,
        leitor,
        extrator: ext,
        embutir: null,
        agora: new Date('2026-11-20T12:00:00Z'),
        tarifa: { entradaPorMilhao: 3, saidaPorMilhao: 15 },
        ...extras,
    }
}

describe('documentarTela', () => {
    it('UMA extração, um artigo por app, cada um com o vocabulário da sua marca', async () => {
        /// A tela mora no core e é a mesma nos três produtos. Extrair por app
        /// pagaria três vezes pelo mesmo trabalho.
        const { leitor } = leitorFalso()
        const { ext, quantas } = extratorFalso()
        const e = escopos()

        const r = await documentarTela({ ...base(), leitor, extrator: ext, escopoDe: e.escopoDe })

        expect(quantas()).toBe(1)
        expect(r.artigos).toBe(2)
        expect(r.custoEstimadoUsd).toBeCloseTo((20_000 / 1e6) * 3 + (1_000 / 1e6) * 15, 5)

        const upsertDe = (appId: string) =>
            e.chamadasDe(appId).find((c) => c.delegado === 'kbArticle' && c.metodo === 'upsert')?.args['create'] as Record<string, string>

        expect(upsertDe('app-odo')?.['titulo']).toBe('Tela: Procedimentos')
        expect(upsertDe('app-con')?.['titulo']).toBe('Tela: Serviços')
        expect(upsertDe('app-odo')?.['corpo']).toContain('Item excluído')
    })

    it('toda escrita leva o appId do seu app, nunca o do vizinho', async () => {
        const e = escopos()
        await documentarTela({ ...base(), escopoDe: e.escopoDe })

        for (const app of APPS) {
            for (const chamada of e.chamadasDe(app.id)) {
                const alvo = (chamada.args['where'] ?? chamada.args['data']) as Record<string, unknown>
                const appId = (alvo?.['appId'] ?? (alvo?.['appId_chave'] as { appId?: string } | undefined)?.appId) as string | undefined
                if (appId !== undefined) expect(appId, `${chamada.delegado}.${chamada.metodo}`).toBe(app.id)
            }
        }
    })

    it('a mesma mensagem no mesmo commit NÃO chama o modelo de novo', async () => {
        /// Cada job de sincronização enfileira as telas do seu app, então a
        /// mesma tela chega três vezes. A segunda e a terceira só renderizam.
        const emDia = {
            id: 'art-1',
            appId: 'app-odo',
            origem: 'DERIVADO',
            chave: 'derivado:tela:vendas-servicos',
            status: 'PUBLICADO',
            titulo: 'Tela: Procedimentos',
            corpo: 'x',
            tags: [],
            statusFixadoPor: null,
            dados: { rota: '/vendas/servicos', ...TELA },
            fonte: { shas: { 'packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx': 'sha-tela' }, versaoDoExtrator: VERSAO_DO_EXTRATOR_DE_TELA },
        }
        const { ext, quantas } = extratorFalso()
        const e = escopos({ 'app-odo': { 'kbArticle.findFirst': emDia } })

        const r = await documentarTela({ ...base(), extrator: ext, escopoDe: e.escopoDe })

        /// O JSON do que já estava em dia serviu para renderizar o outro app.
        expect(quantas()).toBe(0)
        expect(r.efeitos['odontobox']).toBe('em dia')
        expect(r.artigos).toBe(1)
        expect(r.custoEstimadoUsd).toBe(0)
    })

    it('todos em dia: nada a fazer, zero custo', async () => {
        const emDia = (appId: string) => ({
            id: `art-${appId}`,
            appId,
            origem: 'DERIVADO',
            chave: 'derivado:tela:vendas-servicos',
            status: 'PUBLICADO',
            dados: { rota: '/vendas/servicos', ...TELA },
            fonte: { shas: { 'packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx': 'sha-tela' }, versaoDoExtrator: VERSAO_DO_EXTRATOR_DE_TELA },
        })
        const { ext, quantas } = extratorFalso()
        const e = escopos({ 'app-odo': { 'kbArticle.findFirst': emDia('app-odo') }, 'app-con': { 'kbArticle.findFirst': emDia('app-con') } })

        const r = await documentarTela({ ...base(), extrator: ext, escopoDe: e.escopoDe })

        expect(quantas()).toBe(0)
        expect(r.artigos).toBe(0)
        expect(Object.values(r.efeitos)).toEqual(['em dia', 'em dia'])
    })

    it('usa o modelo INCREMENTAL quando a tela já tinha artigo e mudou', async () => {
        const desatualizado = {
            id: 'art-1',
            appId: 'app-odo',
            origem: 'DERIVADO',
            chave: 'derivado:tela:vendas-servicos',
            status: 'PUBLICADO',
            dados: { rota: '/vendas/servicos', ...TELA },
            fonte: { shas: { 'packages/core/src/rotas/(dashboard)/vendas/servicos/page.tsx': 'sha-ANTIGO' }, versaoDoExtrator: VERSAO_DO_EXTRATOR_DE_TELA },
        }
        const primeira = extratorFalso()
        const incremental = extratorFalso()
        const e = escopos({ 'app-odo': { 'kbArticle.findFirst': desatualizado } })

        await documentarTela({ ...base(), extrator: primeira.ext, extratorIncremental: incremental.ext, escopoDe: e.escopoDe })

        expect(incremental.quantas()).toBe(1)
        expect(primeira.quantas()).toBe(0)
    })

    it('o caminho do menu vem do artigo do menu, no vocabulário do app', async () => {
        const artigoDoMenu = { id: 'm1', appId: 'app-odo', origem: 'DERIVADO', chave: 'derivado:menu', status: 'PUBLICADO', dados: MENU, fonte: {} }
        const e = escopos({ 'app-odo': { 'kbArticle.findFirst': artigoDoMenu } })

        await documentarTela({ ...base(), escopoDe: e.escopoDe })

        const create = e.chamadasDe('app-odo').find((c) => c.metodo === 'upsert')?.args['create'] as Record<string, string>
        expect(create?.['titulo']).toBe('Tela: Procedimentos (Vendas → Procedimentos)')
        expect(create?.['corpo']).toContain('Onde fica: Vendas → Procedimentos')
    })

    it('sem o artigo do menu, o artigo diz o endereço — e não um palpite', async () => {
        const e = escopos()
        await documentarTela({ ...base(), escopoDe: e.escopoDe })
        const create = e.chamadasDe('app-odo').find((c) => c.metodo === 'upsert')?.args['create'] as Record<string, string>
        expect(create?.['corpo']).toContain('Endereço: /vendas/servicos')
    })
})
