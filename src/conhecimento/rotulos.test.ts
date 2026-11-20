import { describe, expect, it } from 'vitest'

import { rodape, rotuloDaOrigem, slug, urlDaFonte } from './rotulos.ts'

describe('rótulos de procedência', () => {
    it('o rodapé nomeia a fonte com caminho e sha curto', () => {
        expect(rodape({ descricao: 'menu do produto', caminhos: ['packages/core/src/lib/nav.ts'], commit: 'a'.repeat(40) })).toBe(
            '---\nFonte: menu do produto (packages/core/src/lib/nav.ts @ aaaaaaa)'
        )
    })

    it('com muitos arquivos, resume — o agente lê o artigo inteiro a cada passo', () => {
        /// Medido em 20/11/2026: uma tela com seis arquivos rendia 400
        /// caracteres de rodapé para 1.600 de conteúdo.
        const r = rodape({ descricao: 'a tela X do produto', caminhos: ['a/um.tsx', 'a/dois.ts', 'a/tres.ts', 'a/quatro.ts'], commit: 'b'.repeat(40) })
        expect(r).toBe('---\nFonte: a tela X do produto (a/um.tsx, a/dois.ts e mais 2 arquivos @ bbbbbbb)')
        expect(r.length).toBeLessThan(90)
    })

    it('um arquivo a mais fala no singular', () => {
        expect(rodape({ descricao: 'x', caminhos: ['a', 'b', 'c'], commit: 'c'.repeat(40) })).toContain('e mais 1 arquivo @')
    })

    it('o rótulo do derivado traz data em São Paulo e o commit', () => {
        const r = rotuloDaOrigem({
            origem: 'DERIVADO',
            fonte: { descricao: 'menu do produto', commit: '7c70f74abc' },
            sincronizadoEm: new Date('2026-11-19T17:05:00Z'),
        })
        expect(r).toBe('Fonte: menu do produto, sincronizado em 19/11 às 14h, commit 7c70f74')
    })

    it('manual não tem rótulo; sugerido avisa que aguarda aprovação', () => {
        expect(rotuloDaOrigem({ origem: 'MANUAL', fonte: null, sincronizadoEm: null })).toBeNull()
        expect(rotuloDaOrigem({ origem: 'SUGERIDO', fonte: { ticketId: 't1' }, sincronizadoEm: null })).toContain('aguarda aprovação')
    })

    it('o slug é estável e sem acento', () => {
        expect(slug('O agente parou de responder. O que houve?')).toBe('o-agente-parou-de-responder-o-que-houve')
        expect(slug('Agenda e serviços')).toBe('agenda-e-servicos')
    })

    it('a URL da fonte aponta para o arquivo no commit', () => {
        expect(urlDaFonte('Venn360-Digital/venn-saas', 'apps/odontobox360/src/app/(dashboard)/suporte/page.tsx', 'abc')).toBe(
            'https://github.com/Venn360-Digital/venn-saas/blob/abc/apps/odontobox360/src/app/(dashboard)/suporte/page.tsx'
        )
    })
})
