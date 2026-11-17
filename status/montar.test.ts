import { describe, expect, it } from 'vitest'

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// @ts-expect-error — o gerador é .mjs sem tipos, de propósito: zero dependências.
import { APPS, montar } from './montar.mjs'

function gerar() {
    const destino = mkdtempSync(join(tmpdir(), 'status-'))
    const arquivos: string[] = montar(destino)
    const ler = (caminho: string) => readFileSync(join(destino, caminho), 'utf8')
    return { arquivos, ler }
}

describe('a página de status', () => {
    it('gera índice, uma página por app, 404 e .nojekyll', () => {
        const { arquivos } = gerar()

        expect(arquivos).toContain('index.html')
        expect(arquivos).toContain('404.html')
        expect(arquivos).toContain('.nojekyll')
        for (const app of APPS as { slug: string }[]) {
            expect(arquivos).toContain(`${app.slug}/index.html`)
        }
    })

    it('NÃO assa nenhum veredito no HTML', () => {
        /**
         * A prova que mais importa. Se o estado entrasse no HTML, ele
         * congelaria no instante do build, e uma página que diz "operacional"
         * porque foi gerada ontem é pior que nenhuma página.
         */
        const { ler } = gerar()
        const html = ler('index.html')

        /**
         * O vocabulário ("Operacional", "Fora do ar") ESTÁ no HTML, e tem de
         * estar: é o dicionário que o roteiro usa para escrever na tela sem
         * uma segunda requisição. O que não pode estar é um veredito aplicado —
         * uma pílula já pintada, que o navegador mostraria antes de consultar
         * qualquer coisa e continuaria mostrando se a consulta falhasse.
         */
        expect(html).not.toContain('data-estado="operacional"')
        expect(html).not.toContain('data-estado="fora_do_ar"')

        /// A pílula nasce dizendo que está consultando.
        const pilulas = html.match(/<span class="pilula"[^>]*>([^<]*)</g) ?? []
        expect(pilulas.length).toBe(3)
        for (const pilula of pilulas) expect(pilula).toContain('Consultando')
    })

    it('nomeia os três sistemas mesmo sem a API', () => {
        /// A lista vive no HTML porque a página é mais lida justamente quando a
        /// API está inalcançável.
        const { ler } = gerar()
        const html = ler('index.html')

        for (const app of APPS as { nome: string; slug: string }[]) {
            expect(html).toContain(app.nome)
            expect(html).toContain(`data-app="${app.slug}"`)
        }
    })

    it('carrega as três línguas e diz como falhar', () => {
        const { ler } = gerar()
        const html = ler('odontobox/index.html')

        expect(html).toContain('Venn360 system status')
        expect(html).toContain('Estado de los sistemas Venn360')
        expect(html).toContain('Não foi possível alcançar o Venn Desk')
    })

    it('aponta para a API absoluta, nunca para um caminho relativo', () => {
        /// A página é servida de outro fornecedor: caminho relativo bateria no
        /// GitHub Pages, que não tem API nenhuma.
        const { ler } = gerar()
        const html = ler('conecta/index.html')

        expect(html).toMatch(/const API="https:\/\//)
    })

    it('a página do app traz o formulário de "também fui afetado"', () => {
        const { ler } = gerar()
        const appHtml = ler('stagent/index.html')
        const indiceHtml = ler('index.html')

        expect(appHtml).toContain('id="afetado"')
        expect(appHtml).toContain('type="email"')
        /// No índice não: o clique é por app, e é o app que tem incidente.
        expect(indiceHtml).not.toContain('id="afetado"')
    })
})
