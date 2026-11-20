import { describe, expect, it } from 'vitest'

import { caminhoDoVocabulario, FONTES, FONTE_FAQ, FONTE_MENU, FONTE_PLANOS, FONTE_PRODUTO } from './fontes.ts'

const APP = { id: 'a', slug: 'odontobox', nome: 'Odontobox360', repositorio: 'o/r', pastaNoRepositorio: 'apps/odontobox360' }

describe('o catálogo de fontes', () => {
    it('nenhuma fonte lê docs/ nem plataforma/ — a allowlist é o que protege o cliente', () => {
        /// `docs/re-respond-io/` descreve o produto de um CONCORRENTE. Um
        /// varredor genérico o transformaria em resposta a cliente.
        /// Os três lugares de onde a base viva lê, e nada além: o core
        /// compartilhado, a pasta de um app, e dois arquivos nomeados na raiz.
        const PERMITIDOS = [/^packages\/core\/src\//, /^apps\/[a-z0-9]+\//, /^PRODUCT\.md$/]
        const caminhos = [...FONTES.flatMap((f) => f.caminhos(APP)), caminhoDoVocabulario(APP)]

        for (const c of caminhos) {
            expect(c.startsWith('docs/'), c).toBe(false)
            expect(c.includes('plataforma'), c).toBe(false)
            expect(PERMITIDOS.some((re) => re.test(c)), `caminho fora da allowlist: ${c}`).toBe(true)
        }
    })

    it('a fonte das regras lê o vocabulário EM QUE o PRODUCT.md foi escrito', () => {
        /// O arquivo fala em clínica e paciente porque o Odontobox foi o
        /// primeiro produto. Sem esse segundo caminho, a tradução para os
        /// outros dois partiria do vocabulário errado.
        expect(FONTE_PRODUTO.caminhos(APP)).toEqual(['PRODUCT.md', 'apps/odontobox360/src/config/brand.ts'])
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
        expect(FONTE_FAQ.caminhos(APP)[0]).toBe('apps/odontobox360/src/app/(dashboard)/suporte/page.tsx')
        expect(FONTE_MENU.caminhos(APP)[0]).toBe('packages/core/src/lib/nav.ts')
        expect(FONTE_PLANOS.caminhos(APP)).toHaveLength(2)
    })

    it('as fontes determinísticas vêm antes das que custam modelo', () => {
        /// O teto da rodada corta as que precisam do modelo; uma fonte barata
        /// nunca deve ficar de fora por causa de uma cara.
        const primeiraComModelo = FONTES.findIndex((f) => f.precisaDeModelo)
        const ultimaSemModelo = FONTES.map((f) => f.precisaDeModelo).lastIndexOf(false)
        expect(ultimaSemModelo).toBeLessThan(primeiraComModelo)
    })
})
