import { describe, expect, it } from 'vitest'

import { rodape, rotuloDaOrigem, slug, urlDaFonte } from './rotulos.ts'

describe('rótulos de procedência', () => {
    it('o rodapé nomeia a fonte com caminho e sha curto', () => {
        expect(rodape({ descricao: 'menu do produto', caminhos: ['packages/core/src/lib/nav.ts'], commit: 'a'.repeat(40) })).toBe(
            '---\nFonte: menu do produto (packages/core/src/lib/nav.ts @ aaaaaaa)'
        )
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
