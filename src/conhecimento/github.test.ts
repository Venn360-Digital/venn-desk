import { describe, expect, it } from 'vitest'

import { decodificarBase64, ErroDeLeitura, leitorGitHub } from './github.ts'

type Rota = (url: string, init: RequestInit) => Response | Promise<Response>

function buscadorFalso(rotas: Record<string, Rota>) {
    const pedidos: { url: string; headers: Record<string, string> }[] = []
    const buscar = async (url: string, init: RequestInit) => {
        pedidos.push({ url, headers: init.headers as Record<string, string> })
        const chave = Object.keys(rotas).find((k) => url.includes(k))
        if (chave === undefined) return new Response('{}', { status: 404 })
        return rotas[chave]!(url, init)
    }
    return { buscar, pedidos }
}

const json = (corpo: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(corpo), {
        status: 200,
        ...init,
        headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    })

const SHA = 'a'.repeat(40)

describe('leitorGitHub', () => {
    it('manda o token e a versão da API em todo pedido', async () => {
        const { buscar, pedidos } = buscadorFalso({ '/branches/main': () => json({ commit: { sha: SHA } }) })
        const sha = await leitorGitHub('tok', buscar).shaDoRamo('Venn360-Digital/venn-saas', 'main')

        expect(sha).toBe(SHA)
        expect(pedidos[0]?.headers['Authorization']).toBe('Bearer tok')
        expect(pedidos[0]?.headers['X-GitHub-Api-Version']).toBe('2022-11-28')
    })

    it('reusa o ETag do ramo e aceita 304 sem corpo', async () => {
        /// O cron bate no ramo a cada cinco minutos. Sem ETag seriam 288
        /// requisições por dia só para ouvir "nada mudou".
        let vez = 0
        const { buscar, pedidos } = buscadorFalso({
            '/branches/main': () =>
                vez++ === 0
                    ? json({ commit: { sha: SHA } }, { headers: { etag: 'W/"abc"' } })
                    : new Response(null, { status: 304 }),
        })
        const leitor = leitorGitHub('tok', buscar)

        expect(await leitor.shaDoRamo('o/r', 'main')).toBe(SHA)
        expect(await leitor.shaDoRamo('o/r', 'main')).toBe(SHA)
        expect(pedidos[1]?.headers['If-None-Match']).toBe('W/"abc"')
    })

    it('árvore truncada é falha alta, não lista parcial', async () => {
        const { buscar } = buscadorFalso({ '/git/trees/': () => json({ truncated: true, tree: [] }) })
        await expect(leitorGitHub('tok', buscar).arvore('o/r', SHA)).rejects.toMatchObject({
            codigoDeLeitura: 'arvore_truncada',
        })
    })

    it('a árvore vira mapa só de blobs, por caminho', async () => {
        const { buscar } = buscadorFalso({
            '/git/trees/': () =>
                json({
                    tree: [
                        { path: 'apps', type: 'tree', sha: 't1' },
                        { path: 'apps/a/page.tsx', type: 'blob', sha: 'b1', size: 10 },
                    ],
                }),
        })
        const arvore = await leitorGitHub('tok', buscar).arvore('o/r', SHA)
        expect([...arvore.keys()]).toEqual(['apps/a/page.tsx'])
        expect(arvore.get('apps/a/page.tsx')).toEqual({ sha: 'b1', tamanho: 10 })
    })

    it('decodifica blob base64 com UTF-8 e quebras de linha', async () => {
        const conteudo = btoa(String.fromCharCode(...new TextEncoder().encode('clínica → paciente')))
        const quebrado = `${conteudo.slice(0, 8)}\n${conteudo.slice(8)}`
        const { buscar } = buscadorFalso({
            '/git/blobs/': () => json({ content: quebrado, encoding: 'base64' }),
        })
        expect(await leitorGitHub('tok', buscar).blob('o/r', 'b1')).toBe('clínica → paciente')
    })

    it('nomeia limite de taxa, token inválido e fonte ausente', async () => {
        const casos: [Response, string][] = [
            [new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'limite_de_taxa'],
            [new Response('', { status: 429 }), 'limite_de_taxa'],
            [new Response('', { status: 401 }), 'token_invalido'],
            [new Response('', { status: 403 }), 'token_invalido'],
            [new Response('', { status: 404 }), 'fonte_ausente'],
        ]
        for (const [resposta, codigo] of casos) {
            const { buscar } = buscadorFalso({ '/git/blobs/': () => resposta })
            await expect(leitorGitHub('tok', buscar).blob('o/r', 'x')).rejects.toMatchObject({ codigoDeLeitura: codigo })
        }
    })

    it('commits: separa assunto de corpo e filtra por caminho', async () => {
        const { buscar, pedidos } = buscadorFalso({
            '/commits?': () =>
                json([
                    {
                        sha: SHA,
                        commit: { message: 'fix(suporte): a pílula\n\nDetalhe.', committer: { date: '2026-11-19T10:00:00Z' } },
                    },
                ]),
        })
        const lista = await leitorGitHub('tok', buscar).commits('o/r', { ref: 'main', caminho: 'packages/core', limite: 50 })

        expect(lista[0]).toEqual({ sha: SHA, data: '2026-11-19T10:00:00Z', assunto: 'fix(suporte): a pílula', corpo: 'Detalhe.' })
        expect(pedidos[0]?.url).toContain('path=packages%2Fcore')
    })

    it('comparar devolve caminho e status, com o nome anterior quando renomeou', async () => {
        const { buscar } = buscadorFalso({
            '/compare/': () => json({ files: [{ filename: 'b.ts', status: 'renamed', previous_filename: 'a.ts' }] }),
        })
        const r = await leitorGitHub('tok', buscar).comparar('o/r', 'x', 'y')
        expect(r).toEqual([{ caminho: 'b.ts', status: 'renamed', caminhoAnterior: 'a.ts' }])
    })

    it('o erro é um ErroDeDominio com status 502: o GitHub é fornecedor, não o cliente', () => {
        const erro = new ErroDeLeitura('limite_de_taxa', 'x')
        expect(erro.status).toBe(502)
        expect(erro.codigo).toBe('github_limite_de_taxa')
    })
})

describe('decodificarBase64', () => {
    it('aceita a quebra de linha do GitHub', () => {
        expect(decodificarBase64('b2zDoQ==\n')).toBe('olá')
    })
})
