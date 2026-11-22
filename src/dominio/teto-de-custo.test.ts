import { describe, expect, it } from 'vitest'

import { comecoDoDia, conferirCustoDoDia, FRACAO_DE_ATENCAO, TETO_DIARIO_PADRAO_USD } from './teto-de-custo.ts'

describe('conferirCustoDoDia', () => {
    it('avisa em dois níveis: quando ainda dá para pensar, e quando passou', () => {
        /**
         * Um nível só não serve. O aviso no fim do dia informaria o prejuízo; o
         * de atenção chega com 60% do teto, quando ainda há decisão a tomar.
         */
        expect(conferirCustoDoDia({ gastoUsd: 5, jaAvisado: 'normal' }).nivel).toBe('normal')
        expect(conferirCustoDoDia({ gastoUsd: TETO_DIARIO_PADRAO_USD * FRACAO_DE_ATENCAO, jaAvisado: 'normal' }).nivel).toBe('atencao')
        expect(conferirCustoDoDia({ gastoUsd: TETO_DIARIO_PADRAO_USD, jaAvisado: 'normal' }).nivel).toBe('estouro')
    })

    it('não repete o aviso que já saiu', () => {
        /// O cron roda a cada minuto. Um alerta repetido 1.400 vezes é o mesmo
        /// que nenhum.
        const r = conferirCustoDoDia({ gastoUsd: 30, tetoUsd: 25, jaAvisado: 'estouro' })
        expect(r.nivel).toBe('estouro')
        expect(r.resumo).toBe('')
    })

    it('sobe de atenção para estouro, e nunca desce', () => {
        expect(conferirCustoDoDia({ gastoUsd: 30, tetoUsd: 25, jaAvisado: 'atencao' }).resumo).toContain('passou do teto')
        /// Já avisou estouro; uma leitura menor no mesmo dia não reabre o caso.
        expect(conferirCustoDoDia({ gastoUsd: 20, tetoUsd: 25, jaAvisado: 'estouro' }).resumo).toBe('')
    })

    it('o aviso de estouro diz o que fazer, e não corta nada sozinho', () => {
        /**
         * Cortar automaticamente deixaria cliente sem resposta por causa de uma
         * conta. A decisão de desligar o atendimento automático existe como
         * botão no Console, onde uma pessoa a toma sabendo o que perde.
         */
        const r = conferirCustoDoDia({ gastoUsd: 40, tetoUsd: 25, jaAvisado: 'normal' })
        expect(r.resumo).toContain('US$ 40.00 de US$ 25.00')
        expect(r.resumo).toContain('desligue o atendimento automático')
    })

    it('o dia começa em UTC, que é o relógio do cron', () => {
        const d = comecoDoDia(new Date('2026-11-21T23:30:00Z'))
        expect(d.toISOString()).toBe('2026-11-21T00:00:00.000Z')
    })
})
