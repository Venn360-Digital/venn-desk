import { describe, expect, it } from 'vitest'

import { avaliarMudanca, avisoDeLimite } from './limites-de-correcao.ts'

describe('avaliarMudanca', () => {
    it('correção pequena em caminho comum não exige revisão', () => {
        const v = avaliarMudanca({ linhas: 12, arquivos: 2, lista: [{ caminho: 'packages/core/src/agenda/data.ts' }] })
        expect(v).toEqual({ exigeRevisaoHumana: false, motivos: [] })
        expect(avisoDeLimite(v)).toBe(null)
    })

    it('diff grande exige revisão, porque ninguém revisa 500 linhas de verdade', () => {
        const v = avaliarMudanca({ linhas: 520, arquivos: 3 })
        expect(v.exigeRevisaoHumana).toBe(true)
        expect(v.motivos[0]).toContain('520 linhas')
    })

    it('migração, autenticação e CI são caminhos sensíveis', () => {
        /**
         * Erro nesses lugares não se percebe testando a tela: migração muda
         * dado e não volta atrás, autenticação abre porta em silêncio, e
         * configuração de CI muda QUEM precisa aprovar — o caminho mais curto
         * para desmontar a própria trava.
         */
        const v = avaliarMudanca({
            linhas: 20,
            arquivos: 3,
            lista: [
                { caminho: 'prisma/migrations/20261121_x/migration.sql' },
                { caminho: 'packages/core/src/auth/sessao.ts' },
                { caminho: '.github/workflows/ci.yml' },
            ],
        })

        expect(v.exigeRevisaoHumana).toBe(true)
        expect(v.motivos.join(' ')).toContain('migração de banco')
        expect(v.motivos.join(' ')).toContain('autenticação')
        expect(v.motivos.join(' ')).toContain('configuração de CI')
    })

    it('um motivo por RAZÃO, não por arquivo', () => {
        /// Cinco migrações numa correção são o mesmo alerta, e repeti-lo cinco
        /// vezes esconde os outros.
        const v = avaliarMudanca({
            linhas: 10,
            arquivos: 5,
            lista: [1, 2, 3, 4, 5].map((n) => ({ caminho: `prisma/migrations/2026112${n}_x/migration.sql` })),
        })
        expect(v.motivos).toEqual(['toca migração de banco'])
    })

    it('sem conseguir medir, exige revisão', () => {
        /**
         * "Não sei o que mudou" tem de levar ao mesmo lugar que "mudou muito",
         * nunca a "pode seguir".
         */
        const v = avaliarMudanca({})
        expect(v.exigeRevisaoHumana).toBe(true)
        expect(v.motivos[0]).toContain('não foi possível medir')
    })

    it('o aviso é uma frase que diz o que fazer', () => {
        const v = avaliarMudanca({ linhas: 900, arquivos: 1 })
        expect(avisoDeLimite(v)).toContain('Leia o diff antes de aprovar')
    })
})
