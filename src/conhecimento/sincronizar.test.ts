import { describe, expect, it } from 'vitest'

import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import type { Extrator } from './extrair/com-modelo.ts'
import { ErroDeLeitura, type LeitorDoRepositorio } from './github.ts'
import { enfileirarTelas, sincronizarApp, vigiarConhecimento, type ResultadoDaSincronizacao } from './sincronizar.ts'
import { fixture } from './testes/fixtures.ts'

const APP = { id: 'app-a', slug: 'odontobox', nome: 'Odontobox360', repositorio: 'o/r', pastaNoRepositorio: 'apps/odontobox360' }
const SHA = 'c'.repeat(40)
const TARIFA = { entradaPorMilhao: 3, saidaPorMilhao: 15 }

const ARQUIVOS: Record<string, string> = {
    'apps/odontobox360/src/config/brand.ts': fixture('brand-odontobox.ts.txt'),
    'apps/odontobox360/src/app/(dashboard)/suporte/page.tsx': fixture('suporte-odontobox.page.tsx.txt'),
    'packages/core/src/lib/nav.ts': fixture('nav.ts.txt'),
    'packages/core/src/lib/plan-limits.ts': fixture('plan-limits.ts.txt'),
    'packages/core/src/lib/plans.ts': fixture('plans.ts.txt'),
    'packages/core/src/rotas/api/products/route.ts': fixture('modulo-vendas/api_products_route.ts.txt'),
}

function leitorFalso(arquivos: Record<string, string>, shaDoRamo = SHA) {
    const lidos: string[] = []
    const shaDe = (c: string, t: string) => `${c.length}-${t.length}`
    const porSha = new Map(Object.entries(arquivos).map(([c, t]) => [shaDe(c, t), t]))
    const leitor: LeitorDoRepositorio = {
        async shaDoRamo() {
            return shaDoRamo
        },
        async arvore() {
            return new Map(Object.entries(arquivos).map(([c, t]) => [c, { sha: shaDe(c, t), tamanho: t.length }]))
        },
        async blob(_r, sha) {
            lidos.push(sha)
            const t = porSha.get(sha)
            if (t === undefined) throw new ErroDeLeitura('fonte_ausente', sha)
            return t
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

const MENU_FALSO = {
    secoes: [
        { rotulo: 'Dashboard', href: '/dashboard', papeis: ['OWNER', 'ADMIN', 'GESTOR'] },
        { rotulo: 'Favoritos', itens: [{ rotulo: 'Conversas', href: '/atendimento/conversas' }] },
        { rotulo: 'Vendas (CRM)', itens: [{ rotulo: '{{Pessoas}}', href: '/vendas/clientes' }, { rotulo: '{{Servicos}}', href: '/vendas/servicos' }] },
    ],
    segmentos: { vendas: 'Vendas', servicos: '{{Servicos}}', clientes: '{{Pessoas}}' },
}

function extratorFalso(respostas: Record<string, unknown>) {
    const pedidos: string[] = []
    const extrator: Extrator = {
        async extrair(pedido) {
            const chave = pedido.arquivos[0]?.caminho ?? ''
            pedidos.push(chave)
            const dados = respostas[chave]
            if (dados === undefined) throw new Error(`sem resposta falsa para ${chave}`)
            return { dados: pedido.esquema.parse(dados), consumo: { passos: 1, tokensDeEntrada: 1000, tokensDeSaida: 200 } }
        },
    }
    return { extrator, pedidos }
}

describe('sincronizarApp', () => {
    it('primeira rodada: 28 artigos da FAQ criados POR UPSERT com o appId; fontes de modelo puladas sem chave', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': null })
        const { leitor } = leitorFalso(ARQUIVOS)

        const r = await sincronizarApp({
            escopo: escopoDoApp(conexao, 'app-a'), app: APP, leitor, extrator: null, embutir: null,
            commitSha: SHA, anterior: null, agora: new Date('2026-11-19T12:00:00Z'), tarifa: TARIFA,
        })

        expect(r.fontes['faq']).toMatchObject({ estado: 'ok', criados: 28, extraidoPor: 'parser' })
        expect(r.fontes['menu']).toMatchObject({ estado: 'pulada' })
        expect(r.fontes['planos']).toMatchObject({ estado: 'pulada' })
        expect(r.custoEstimadoUsd).toBe(0)

        const upserts = chamadas.filter((c) => c.delegado === 'kbArticle' && c.metodo === 'upsert')
        expect(upserts.length).toBeGreaterThanOrEqual(28)
        for (const u of upserts) {
            expect((u.args['where'] as { appId_chave: { appId: string } }).appId_chave.appId).toBe('app-a')
            expect((u.args['create'] as Record<string, unknown>)['status']).toBe('PUBLICADO')
        }
        /// O mapa técnico cobriu o único arquivo do core com módulo (products).
        expect(r.mapa).toMatchObject({ apis: 1 })
        /// Sem Workers AI, a rodada avisa que os artigos ficaram sem vetor.
        expect(r.avisos[0]).toContain('sem vetor')
    })

    it('segunda rodada com os mesmos shas: zero leitura da FAQ, só a data é tocada', async () => {
        const { conexao } = conexaoFalsa({ 'kbArticle.findFirst': null })
        const { leitor, lidos } = leitorFalso(ARQUIVOS)
        const escopo = escopoDoApp(conexao, 'app-a')
        const base = { escopo, app: APP, leitor, extrator: null, embutir: null, commitSha: SHA, agora: new Date(), tarifa: TARIFA }

        const primeira = await sincronizarApp({ ...base, anterior: null })
        const antes = lidos.length
        const segunda = await sincronizarApp({ ...base, anterior: primeira })

        expect(segunda.fontes['faq']).toMatchObject({ estado: 'inalterada', inalterados: 28 })
        expect(segunda.fontes['faq']?.chaves).toEqual(primeira.fontes['faq']?.chaves)
        /// Só o vocabulário é relido (ele sempre é); a FAQ e o mapa, não.
        expect(lidos.length - antes).toBe(1)
    })

    it('com extrator, o menu entra e o custo é somado; ancoragem reprova e a fonte falha SEM derrubar as outras', async () => {
        const { conexao } = conexaoFalsa({ 'kbArticle.findFirst': null })
        const { leitor } = leitorFalso(ARQUIVOS)
        const { extrator, pedidos } = extratorFalso({
            'packages/core/src/lib/nav.ts': MENU_FALSO,
            /// Planos com um número que não existe no arquivo: a ancoragem pega.
            'packages/core/src/lib/plan-limits.ts': {
                planos: [
                    { id: 'flow', nome: 'Plano Digital', precoMensal: 999, descricao: 'que precisam conectar', limites: { unidades: 1, agentes: 1, numerosWhatsApp: 1, creditos: 10000, mensagens: 10000, respostasFaladas: 400, destinatariosBroadcastMes: 1000, emailsMes: 10000 }, itens: [] },
                    { id: 'pro', nome: 'Plano Prime', precoMensal: 590, descricao: 'que precisam conectar', limites: { unidades: 1, agentes: 2, numerosWhatsApp: 4, creditos: 20000, mensagens: 20000, respostasFaladas: 750, destinatariosBroadcastMes: 5000, emailsMes: 50000 }, itens: [] },
                    { id: 'advanced', nome: 'Plano Multiclínica', precoMensal: 890, descricao: 'que precisam conectar', limites: { unidades: 3, agentes: 3, numerosWhatsApp: 6, creditos: 30000, mensagens: 30000, respostasFaladas: 1500, destinatariosBroadcastMes: 20000, emailsMes: 200000 }, itens: [] },
                ],
                unidadeAdicional: { precoMensal: 290, inclui: ['1 unidade'] },
                descontoAnual: 0.1,
            },
        })

        const r = await sincronizarApp({
            escopo: escopoDoApp(conexao, 'app-a'), app: APP, leitor, extrator, embutir: null,
            commitSha: SHA, anterior: null, agora: new Date(), tarifa: TARIFA,
        })

        expect(pedidos).toHaveLength(2)
        expect(r.fontes['menu']).toMatchObject({ estado: 'ok', criados: 1, extraidoPor: 'modelo' })
        expect(r.fontes['planos']?.estado).toBe('falhou')
        expect(r.fontes['planos']?.erro).toContain('999')
        expect(r.fontes['faq']?.estado).toBe('ok')
        expect(r.consumo.passos).toBe(2)
        expect(r.custoEstimadoUsd).toBeCloseTo((2000 / 1e6) * 3 + (400 / 1e6) * 15, 5)
    })

    it('fonte que sumiu do commit: arquiva o que ela tinha e fica vermelha', async () => {
        const vivo = { id: 'a1', appId: 'app-a', origem: 'DERIVADO', chave: 'derivado:faq:x', status: 'PUBLICADO' }
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': null, 'kbArticle.findMany': [vivo] })
        const semFaq = { ...ARQUIVOS }
        delete semFaq['apps/odontobox360/src/app/(dashboard)/suporte/page.tsx']
        const { leitor } = leitorFalso(semFaq)

        const r = await sincronizarApp({
            escopo: escopoDoApp(conexao, 'app-a'), app: APP, leitor, extrator: null, embutir: null,
            commitSha: SHA, anterior: null, agora: new Date(), tarifa: TARIFA,
        })

        expect(r.fontes['faq']).toMatchObject({ estado: 'falhou', arquivados: 1 })
        const evento = chamadas.find((c) => c.delegado === 'kbEvento' && (c.args['data'] as Record<string, unknown>)['evento'] === 'artigo:derivado-arquivado')
        expect(evento).toBeDefined()
    })

    it('sem vocabulário não há rodada: tudo depende dele', async () => {
        const { conexao } = conexaoFalsa()
        const semBrand = { ...ARQUIVOS }
        delete semBrand['apps/odontobox360/src/config/brand.ts']
        const { leitor } = leitorFalso(semBrand)

        await expect(
            sincronizarApp({ escopo: escopoDoApp(conexao, 'app-a'), app: APP, leitor, extrator: null, embutir: null, commitSha: SHA, anterior: null, agora: new Date(), tarifa: TARIFA })
        ).rejects.toThrow('vocabulario')
    })

    it('limite de taxa do GitHub derruba a rodada inteira (para repetir depois)', async () => {
        const { conexao } = conexaoFalsa({ 'kbArticle.findFirst': null })
        const { leitor } = leitorFalso(ARQUIVOS)
        leitor.blob = async () => {
            throw new ErroDeLeitura('limite_de_taxa', 'x')
        }
        await expect(
            sincronizarApp({ escopo: escopoDoApp(conexao, 'app-a'), app: APP, leitor, extrator: null, embutir: null, commitSha: SHA, anterior: null, agora: new Date(), tarifa: TARIFA })
        ).rejects.toMatchObject({ codigoDeLeitura: 'limite_de_taxa' })
    })

    it('publicado sem vetor (manual, ou de rodada em que o AI falhou) é reparado na rodada seguinte', async () => {
        /// Em staging, 108 artigos ficaram sem vetor porque o primeiro lote
        /// estourou o bge-m3; a rodada seguinte os viu "inalterados" e não
        /// re-embutiu nada. O reparo lista o que está no ar sem vetor.
        const { conexao, chamadas } = conexaoFalsa({
            'kbArticle.findFirst': null,
            'sql.queryRaw': [{ id: 'manual-1', titulo: 'Como troco a senha', corpo: 'Conta → Segurança.', tags: [] }],
        })
        const { leitor } = leitorFalso(ARQUIVOS)
        const embutidos: string[] = []
        const embutir = async (textos: string[]) => {
            embutidos.push(...textos)
            return textos.map(() => Array.from({ length: 1024 }, () => 0.1))
        }

        await sincronizarApp({ escopo: escopoDoApp(conexao, 'app-a'), app: APP, leitor, extrator: null, embutir, commitSha: SHA, anterior: null, agora: new Date(), tarifa: TARIFA })

        expect(embutidos.some((t) => t.includes('Como troco a senha'))).toBe(true)
        const gravacoes = chamadas.filter((c) => c.delegado === 'sql' && c.metodo === 'executeRaw')
        expect(gravacoes.some((g) => (g.args['valores'] as unknown[]).includes('manual-1'))).toBe(true)
        const listagem = chamadas.find((c) => c.delegado === 'sql' && c.metodo === 'queryRaw')
        expect(listagem?.args['sql']).toContain('embedding IS NULL')
        expect(listagem?.args['valores']).toContain('app-a')
    })

    it('com Workers AI, os artigos novos ganham vetor em lote, com o appId no SQL', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'kbArticle.findFirst': null })
        const { leitor } = leitorFalso(ARQUIVOS)
        const lotes: number[] = []
        const embutir = async (textos: string[]) => {
            lotes.push(textos.length)
            return textos.map(() => Array.from({ length: 1024 }, () => 0.1))
        }

        await sincronizarApp({ escopo: escopoDoApp(conexao, 'app-a'), app: APP, leitor, extrator: null, embutir, commitSha: SHA, anterior: null, agora: new Date(), tarifa: TARIFA })

        expect(lotes.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(28)
        const escritas = chamadas.filter((c) => c.delegado === 'sql' && c.metodo === 'executeRaw')
        expect(escritas.length).toBeGreaterThanOrEqual(28)
        expect(escritas[0]?.args['valores']).toContain('app-a')
    })
})

describe('vigiarConhecimento', () => {
    const appsFalsos = [{ id: 'app-a', slug: 'odontobox', nome: 'O', repositorio: 'o/r', pastaNoRepositorio: 'apps/odontobox360', excluidoEm: null }]

    function clienteFalso(sincronizacoes: Record<string, unknown>) {
        const enviados: unknown[] = []
        const { conexao, chamadas } = conexaoFalsa({ 'app.findMany': appsFalsos, ...sincronizacoes })
        const fila = { send: async (m: unknown) => void enviados.push(m) }
        return { cliente: conexao as unknown as Parameters<typeof vigiarConhecimento>[0], chamadas, fila, enviados }
    }

    it('main andou e nada em andamento: registra o pedido e enfileira', async () => {
        const { cliente, fila, enviados } = clienteFalso({ 'kbSincronizacao.findFirst': null })
        const { leitor } = leitorFalso(ARQUIVOS)
        const acoes = await vigiarConhecimento(cliente, { leitor, fila, agora: new Date() })
        expect(acoes).toEqual([{ app: 'odontobox', acao: 'enfileirada', detalhe: SHA.slice(0, 7) }])
        expect(enviados[0]).toMatchObject({ tipo: 'sincronizar', appId: 'app-a', commitSha: SHA })
    })

    it('já sincronizado neste commit: em dia, sem fila', async () => {
        const { cliente, fila, enviados } = clienteFalso({
            'kbSincronizacao.findFirst': (args: { where: Record<string, unknown> }) =>
                args.where['estado'] === 'concluida' ? { commitSha: SHA, criadaEm: new Date(), estado: 'concluida' } : null,
        })
        const { leitor } = leitorFalso(ARQUIVOS)
        const acoes = await vigiarConhecimento(cliente, { leitor, fila, agora: new Date() })
        expect(acoes[0]?.acao).toBe('em_dia')
        expect(enviados).toEqual([])
    })

    it('uma em andamento há menos de 30 min: espera', async () => {
        const agora = new Date()
        const { cliente, fila, enviados } = clienteFalso({
            'kbSincronizacao.findFirst': (args: { where: Record<string, unknown> }) =>
                typeof args.where['estado'] === 'object' ? { id: 's1', estado: 'em_andamento', criadaEm: new Date(agora.getTime() - 60_000) } : null,
        })
        const { leitor } = leitorFalso(ARQUIVOS)
        const acoes = await vigiarConhecimento(cliente, { leitor, fila, agora })
        expect(acoes[0]?.acao).toBe('em_andamento')
        expect(enviados).toEqual([])
    })

    it('sem fila configurada não faz nada', async () => {
        const { cliente } = clienteFalso({})
        const { leitor } = leitorFalso(ARQUIVOS)
        expect(await vigiarConhecimento(cliente, { leitor, fila: undefined, agora: new Date() })).toEqual([])
    })
})

/// Garante que o tipo exportado é o que a fila grava e relê.
const _tipo: ResultadoDaSincronizacao | null = null
void _tipo

describe('enfileirarTelas', () => {
    const R = 'packages/core/src/'
    const INDICE = {
        commit: SHA,
        telas: [
            {
                rota: '/vendas/servicos',
                modulo: 'vendas',
                arquivos: [`${R}rotas/(dashboard)/vendas/servicos/page.tsx`],
                componentes: [],
                apis: [],
                modelos: [],
            },
            {
                rota: '/vendas/clientes',
                modulo: 'vendas',
                arquivos: [`${R}rotas/(dashboard)/vendas/clientes/page.tsx`],
                componentes: [],
                apis: [],
                modelos: [],
            },
        ],
        apis: [],
        arquivosPorModulo: {},
        analises: {},
    }
    const arvore = () =>
        new Map([
            [`${R}rotas/(dashboard)/vendas/servicos/page.tsx`, { sha: 'sha-serv', tamanho: 100 }],
            [`${R}rotas/(dashboard)/vendas/clientes/page.tsx`, { sha: 'sha-cli', tamanho: 100 }],
        ])

    const emDia = (chave: string, sha: string, caminho: string) => ({
        id: `art-${chave}`,
        appId: 'app-a',
        origem: 'DERIVADO',
        chave,
        status: 'PUBLICADO',
        fonte: { shas: { [caminho]: sha }, versaoDoExtrator: 1 },
    })

    it('enfileira só as telas desatualizadas, e conta as que já estão em dia', async () => {
        const { conexao } = conexaoFalsa({
            'kbArticle.findMany': [emDia('derivado:tela:vendas-servicos', 'sha-serv', `${R}rotas/(dashboard)/vendas/servicos/page.tsx`)],
        })
        const enviados: unknown[] = []

        const r = await enfileirarTelas({
            escopo: escopoDoApp(conexao, 'app-a'),
            indice: INDICE,
            arvore: arvore(),
            commitSha: SHA,
            fila: { send: async (m) => void enviados.push(m) },
            apps: [APP],
            agora: new Date(),
            teto: 40,
        })

        expect(r).toMatchObject({ total: 2, emDia: 1, enfileiradas: 1, adiadas: 0 })
        expect(enviados).toHaveLength(1)
        expect(enviados[0]).toMatchObject({ tipo: 'documentar-tela', rota: '/vendas/clientes', appIds: ['app-a'] })
    })

    it('a mensagem leva TODOS os apps irmãos: a tela é a mesma nos três', async () => {
        const { conexao } = conexaoFalsa({ 'kbArticle.findMany': [] })
        const enviados: { appIds?: string[] }[] = []
        const irmaos = [APP, { ...APP, id: 'app-b', slug: 'conecta' }, { ...APP, id: 'app-c', slug: 'stagent' }]

        await enfileirarTelas({
            escopo: escopoDoApp(conexao, 'app-a'),
            indice: INDICE,
            arvore: arvore(),
            commitSha: SHA,
            fila: { send: async (m) => void enviados.push(m as { appIds?: string[] }) },
            apps: irmaos,
            agora: new Date(),
            teto: 40,
        })

        expect(enviados[0]?.appIds).toEqual(['app-a', 'app-b', 'app-c'])
    })

    it('rota que saiu do produto tem o artigo ARQUIVADO, com evento', async () => {
        const morta = { id: 'art-morta', appId: 'app-a', origem: 'DERIVADO', chave: 'derivado:tela:vendas-sumiu', status: 'PUBLICADO' }
        let vez = 0
        const { conexao, chamadas } = conexaoFalsa({
            /// Primeiro `findMany` é a listagem dos derivados; o segundo é o de
            /// arquivar fora das chaves vivas.
            'kbArticle.findMany': () => (vez++ === 0 ? [] : [morta]),
        })

        const r = await enfileirarTelas({
            escopo: escopoDoApp(conexao, 'app-a'),
            indice: INDICE,
            arvore: arvore(),
            commitSha: SHA,
            fila: undefined,
            apps: [APP],
            agora: new Date(),
            teto: 40,
        })

        expect(r.arquivados).toBe(1)
        const evento = chamadas.find((c) => c.delegado === 'kbEvento')
        expect((evento?.args['data'] as Record<string, unknown>)?.['evento']).toBe('artigo:derivado-arquivado')
    })

    it('o teto adia o resto para a próxima rodada', async () => {
        const { conexao } = conexaoFalsa({ 'kbArticle.findMany': [] })
        const enviados: unknown[] = []
        const r = await enfileirarTelas({
            escopo: escopoDoApp(conexao, 'app-a'),
            indice: INDICE,
            arvore: arvore(),
            commitSha: SHA,
            fila: { send: async (m) => void enviados.push(m) },
            apps: [APP],
            agora: new Date(),
            teto: 1,
        })

        expect(r).toMatchObject({ enfileiradas: 1, adiadas: 1 })
        expect(enviados).toHaveLength(1)
    })

    it('sem fila, nada é enfileirado — e isso é registrado, não escondido', async () => {
        const { conexao } = conexaoFalsa({ 'kbArticle.findMany': [] })
        const r = await enfileirarTelas({
            escopo: escopoDoApp(conexao, 'app-a'),
            indice: INDICE,
            arvore: arvore(),
            commitSha: SHA,
            fila: undefined,
            apps: [APP],
            agora: new Date(),
            teto: 40,
        })
        expect(r).toMatchObject({ total: 2, enfileiradas: 0 })
    })
})
