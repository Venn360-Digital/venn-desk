import { describe, expect, it } from 'vitest'

import { caminhoDoVocabulario, FONTES } from './fontes.ts'

const APP = { id: 'a', slug: 'odontobox', nome: 'Odontobox360', repositorio: 'o/r', pastaNoRepositorio: 'apps/odontobox360' }

describe('o catálogo de fontes', () => {
    it('nenhuma fonte lê docs/ nem plataforma/ — a allowlist é o que protege o cliente', () => {
        /// `docs/re-respond-io/` descreve o produto de um CONCORRENTE. Um
        /// varredor genérico o transformaria em resposta a cliente.
        const caminhos = [...FONTES.flatMap((f) => f.caminhos(APP)), caminhoDoVocabulario(APP)]
        for (const c of caminhos) {
            expect(c.startsWith('docs/'), c).toBe(false)
            expect(c.includes('/plataforma/'), c).toBe(false)
            expect(c.startsWith('packages/core/src/') || c.startsWith('apps/odontobox360/'), c).toBe(true)
        }
    })

    it('os prefixos de chave são únicos, para arquivar fora não atingir outra fonte', () => {
        const prefixos = FONTES.map((f) => f.prefixoDaChave)
        expect(new Set(prefixos).size).toBe(prefixos.length)
        for (const a of prefixos) for (const b of prefixos) {
            if (a !== b) expect(a.startsWith(b), `${a} contém ${b}`).toBe(false)
        }
    })

    it('toda fonte tem versão de extrator positiva', () => {
        for (const f of FONTES) expect(f.versaoDoExtrator).toBeGreaterThanOrEqual(1)
    })

    it('a FAQ é do app (pasta do app); menu e planos são do core compartilhado', () => {
        const [faq, menu, planos] = FONTES
        expect(faq?.caminhos(APP)[0]).toBe('apps/odontobox360/src/app/(dashboard)/suporte/page.tsx')
        expect(menu?.caminhos(APP)[0]).toBe('packages/core/src/lib/nav.ts')
        expect(planos?.caminhos(APP)).toHaveLength(2)
    })
})
