import { describe, expect, it } from 'vitest'

import {
    CALENDARIO_COMERCIAL,
    calendarioDaPolitica,
    dentroDoHorario,
    vencimentoComercial,
    type Calendario,
} from './calendario.ts'

/** 17h de sexta em São Paulo (UTC-3) é 20h UTC. */
const SEXTA_17H = new Date('2026-11-20T20:00:00Z')

describe('vencimentoComercial', () => {
    it('conta dentro da janela quando o prazo cabe no dia', () => {
        /// 10h de São Paulo + 2h úteis = 12h, no mesmo dia.
        const dezDaManha = new Date('2026-11-20T13:00:00Z')
        const venc = vencimentoComercial(dezDaManha, 120, CALENDARIO_COMERCIAL)
        expect(venc.toISOString()).toBe('2026-11-20T15:00:00.000Z')
    })

    it('o prazo de sexta à tarde atravessa o fim de semana', () => {
        /**
         * O caso que motiva o módulo: 8 horas abertas às 17h de sexta venciam à
         * 1h de sábado e apareciam como violadas na segunda, sem que ninguém
         * tivesse deixado de trabalhar.
         */
        const venc = vencimentoComercial(SEXTA_17H, 8 * 60, CALENDARIO_COMERCIAL)

        /// Sobra 1h de sexta (17h→18h); as 7h restantes caem na segunda,
        /// 9h→16h local = 19h UTC.
        expect(venc.toISOString()).toBe('2026-11-23T19:00:00.000Z')
    })

    it('chamado que chega de madrugada só começa a consumir na abertura', () => {
        /// 3h de São Paulo numa quinta. O prazo de 1h vence às 10h, não às 4h.
        const madrugada = new Date('2026-11-19T06:00:00Z')
        expect(vencimentoComercial(madrugada, 60, CALENDARIO_COMERCIAL).toISOString()).toBe(
            '2026-11-19T13:00:00.000Z'
        )
    })

    it('feriado não consome prazo', () => {
        const comFeriado: Calendario = { ...CALENDARIO_COMERCIAL, feriados: ['2026-11-20'] }
        /// Sexta é feriado: as 2h caem na segunda, 9h→11h local = 14h UTC.
        const sextaManha = new Date('2026-11-20T13:00:00Z')
        expect(vencimentoComercial(sextaManha, 120, comFeriado).toISOString()).toBe('2026-11-23T14:00:00.000Z')
    })

    it('duas janelas no dia pulam o almoço', () => {
        const comAlmoco: Calendario = {
            fuso: 'America/Sao_Paulo',
            dias: { 5: [{ de: '09:00', ate: '12:00' }, { de: '13:00', ate: '18:00' }] },
        }
        /// 11h local + 2h úteis: 1h até o almoço, 1h depois dele → 14h local.
        const onzeDaManha = new Date('2026-11-20T14:00:00Z')
        expect(vencimentoComercial(onzeDaManha, 120, comAlmoco).toISOString()).toBe('2026-11-20T17:00:00.000Z')
    })

    it('prazo zero ou negativo vence agora', () => {
        expect(vencimentoComercial(SEXTA_17H, 0, CALENDARIO_COMERCIAL)).toEqual(SEXTA_17H)
    })

    it('calendário sem janela nenhuma cai para prazo CORRIDO', () => {
        /**
         * Acontece com configuração errada. Devolver uma data em 2028
         * esconderia o erro; prazo corrido vira violação no mesmo dia, que é o
         * sintoma que faz alguém olhar.
         */
        const vazio: Calendario = { fuso: 'America/Sao_Paulo', dias: {} }
        expect(vencimentoComercial(SEXTA_17H, 60, vazio).toISOString()).toBe('2026-11-20T21:00:00.000Z')
    })

    it('atravessa o horário de verão sem perder nem ganhar hora útil', () => {
        /// Fuso com horário de verão real: Nova York muda em 8/3/2026.
        const ny: Calendario = { fuso: 'America/New_York', dias: { 1: [{ de: '09:00', ate: '18:00' }] } }
        /// Segunda 9/3/2026, 10h local (EDT, UTC-4) + 3h = 13h local.
        const segunda = new Date('2026-03-09T14:00:00Z')
        expect(vencimentoComercial(segunda, 180, ny).toISOString()).toBe('2026-03-09T17:00:00.000Z')
    })
})

describe('dentroDoHorario', () => {
    it('distingue hora comercial de fim de semana', () => {
        expect(dentroDoHorario(new Date('2026-11-20T15:00:00Z'), CALENDARIO_COMERCIAL)).toBe(true)
        /// 20h UTC de sexta é 17h local: ainda dentro.
        expect(dentroDoHorario(SEXTA_17H, CALENDARIO_COMERCIAL)).toBe(true)
        /// Sábado.
        expect(dentroDoHorario(new Date('2026-11-21T15:00:00Z'), CALENDARIO_COMERCIAL)).toBe(false)
        /// 23h local de sexta.
        expect(dentroDoHorario(new Date('2026-11-21T02:00:00Z'), CALENDARIO_COMERCIAL)).toBe(false)
    })
})

describe('calendarioDaPolitica', () => {
    it('aceita o que tem fuso e dias, e recusa o resto', () => {
        expect(calendarioDaPolitica(CALENDARIO_COMERCIAL)).toEqual(CALENDARIO_COMERCIAL)
        expect(calendarioDaPolitica(null)).toBe(null)
        expect(calendarioDaPolitica({ fuso: 'America/Sao_Paulo' })).toBe(null)
        expect(calendarioDaPolitica('America/Sao_Paulo')).toBe(null)
    })
})
