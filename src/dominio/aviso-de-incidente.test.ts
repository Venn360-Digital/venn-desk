import { describe, expect, it } from 'vitest'

import { avisoDeIncidente, duracaoEmMinutos } from './aviso-de-incidente.ts'

const DESDE = new Date('2026-11-23T14:00:00Z')

describe('avisoDeIncidente', () => {
    it('app de pé não mostra faixa nenhuma', () => {
        expect(avisoDeIncidente({ estado: 'operacional', desdeEm: null }).mostrar).toBe(false)
        /// Desconhecido também não: uma faixa de incidente por falta de dado
        /// assustaria sem informar.
        expect(avisoDeIncidente({ estado: 'desconhecido', desdeEm: null }).mostrar).toBe(false)
    })

    it('diz que não é preciso abrir chamado', () => {
        /**
         * Sem esta frase, um app fora do ar gera dezenas de chamados do mesmo
         * incidente, e cada um consome atendimento que deveria estar resolvendo
         * a causa.
         */
        const aviso = avisoDeIncidente({ estado: 'fora_do_ar', desdeEm: DESDE })
        expect(aviso.mostrar).toBe(true)
        expect(aviso.detalhe).toContain('não é preciso abrir chamado')
        /// E deixa a porta aberta para quem tem outro problema.
        expect(aviso.detalhe).toContain('Se o seu problema for outro')
        expect(aviso.desdeEm).toBe('2026-11-23T14:00:00.000Z')
    })

    it('só "fora do ar" mostra faixa, porque é o único estado que a saúde mede', () => {
        /**
         * A verificação devolve três estados: operacional, fora do ar e
         * desconhecido. Inventar "instável" aqui faria o widget prometer uma
         * distinção que ninguém mede.
         */
        expect(avisoDeIncidente({ estado: 'fora_do_ar', desdeEm: DESDE }).titulo).toContain('indisponibilidade')
    })

    it('o texto NUNCA leva detalhe técnico', () => {
        /// "HTTP 502" é verdade e não é informação para quem quer marcar uma
        /// consulta. O texto é nosso, e por isso não há como vazar.
        const aviso = avisoDeIncidente({ estado: 'fora_do_ar', desdeEm: DESDE })
        expect(`${aviso.titulo} ${aviso.detalhe}`).not.toMatch(/HTTP|50\d|timeout|DNS/i)
    })
})

describe('duracaoEmMinutos', () => {
    it('conta o que terminou e deixa nulo o que corre', () => {
        expect(duracaoEmMinutos(DESDE, new Date('2026-11-23T14:45:00Z'))).toBe(45)
        expect(duracaoEmMinutos(DESDE, null)).toBe(null)
    })

    it('episódio com fim antes do início não vira número negativo', () => {
        /// Acontece com relógio corrigido no meio; negativo na tela pública
        /// seria pior que zero.
        expect(duracaoEmMinutos(DESDE, new Date('2026-11-23T13:00:00Z'))).toBe(0)
    })
})
