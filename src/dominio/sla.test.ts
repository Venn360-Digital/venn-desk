import { describe, expect, it } from 'vitest'

import {
    aoMudarStatus,
    estadoDoRelogio,
    FRACAO_DE_RISCO,
    METAS_PADRAO,
    metaEmMinutos,
    pedeCaoDeGuarda,
    restanteMs,
    vencimentoDe,
    type Relogio,
} from './sla.ts'

const T0 = new Date('2026-11-17T12:00:00.000Z')
const minutos = (n: number) => new Date(T0.getTime() + n * 60_000)

function relogio(ajustes: Partial<Relogio> = {}): Relogio {
    return {
        meta: 'primeira_resposta',
        metaMin: 60,
        venceEm: minutos(60),
        pausadoEm: null,
        violadoEm: null,
        cumpridoEm: null,
        ...ajustes,
    }
}

describe('metas', () => {
    it('o urgente é mais apertado que o baixo em todas as metas', () => {
        for (const meta of ['primeira_resposta', 'proxima_resposta', 'resolucao'] as const) {
            expect(metaEmMinutos(METAS_PADRAO.URGENTE, meta)).toBeLessThan(
                metaEmMinutos(METAS_PADRAO.BAIXA, meta)
            )
        }
    })

    it('a primeira resposta é sempre mais curta que a resolução', () => {
        for (const prioridade of ['BAIXA', 'NORMAL', 'ALTA', 'URGENTE'] as const) {
            const m = METAS_PADRAO[prioridade]
            expect(m.primeiraRespostaMin).toBeLessThan(m.resolucaoMin)
        }
    })

    it('o vencimento é o início mais a meta', () => {
        expect(vencimentoDe(T0, 90)).toEqual(minutos(90))
    })
})

describe('estado do relógio', () => {
    it('em dia no começo', () => {
        expect(estadoDoRelogio(relogio(), T0)).toBe('em_dia')
    })

    it('em risco na fatia final, proporcional à meta', () => {
        /// 20% de 60 min = 12 min. Em 13 ainda está em dia; em 12, em risco.
        expect(estadoDoRelogio(relogio(), minutos(60 - 13))).toBe('em_dia')
        expect(estadoDoRelogio(relogio(), minutos(60 - 12))).toBe('em_risco')
    })

    it('o risco acompanha a meta, e não um número fixo de minutos', () => {
        /**
         * 10 minutos antes do fim é aviso útil numa meta de 15 minutos e ruído
         * numa de 72 horas. A fatia é proporcional, por isso.
         */
        const curto = relogio({ metaMin: 15, venceEm: minutos(15) })
        const longo = relogio({ metaMin: 72 * 60, venceEm: minutos(72 * 60) })

        /// Quantos minutos antes do fim o aviso começa, em cada meta.
        const comecaFaltando = (r: Relogio) => {
            for (let falta = 1; falta <= r.metaMin; falta += 1) {
                const quando = new Date(r.venceEm.getTime() - falta * 60_000)
                if (estadoDoRelogio(r, quando) === 'em_dia') return falta - 1
            }
            return r.metaMin
        }

        /// 20% de 15 min = 3 min. 20% de 72 h = 14 h 24 min.
        expect(comecaFaltando(curto)).toBe(3)
        expect(comecaFaltando(longo)).toBe(0.2 * 72 * 60)

        /// E é por isso que um limiar fixo não serviria: 10 minutos antes do
        /// fim é cedo demais numa meta de 15 min e tarde demais numa de 72 h.
        const faltando10 = (r: Relogio) =>
            estadoDoRelogio(r, new Date(r.venceEm.getTime() - 10 * 60_000))

        expect(faltando10(curto)).toBe('em_dia')
        expect(faltando10(longo)).toBe('em_risco')
    })

    it('vencido quando o prazo passou e ninguém marcou', () => {
        expect(estadoDoRelogio(relogio(), minutos(61))).toBe('vencido')
        /// Exatamente no vencimento já conta: o prazo era "até".
        expect(estadoDoRelogio(relogio(), minutos(60))).toBe('vencido')
    })

    it('cumprido e violado são finais e vencem o resto', () => {
        /// Um relógio já violado que depois pausa não volta a ser "pausado".
        const violadoEPausado = relogio({ violadoEm: minutos(61), pausadoEm: minutos(70) })
        expect(estadoDoRelogio(violadoEPausado, minutos(80))).toBe('violado')

        const cumpridoEVencido = relogio({ cumpridoEm: minutos(10) })
        expect(estadoDoRelogio(cumpridoEVencido, minutos(999))).toBe('cumprido')
    })

    it('parado, o que falta é o que faltava quando parou', () => {
        const pausado = relogio({ pausadoEm: minutos(20) })

        /// Faltavam 40 min ao pausar. Três dias depois, continuam 40.
        expect(restanteMs(pausado, minutos(20))).toBe(40 * 60_000)
        expect(restanteMs(pausado, minutos(3 * 24 * 60))).toBe(40 * 60_000)
        expect(estadoDoRelogio(pausado, minutos(3 * 24 * 60))).toBe('pausado')
    })
})

describe('a aritmética da pausa', () => {
    it('pausa quando a bola passa para o usuário', () => {
        expect(aoMudarStatus(relogio(), 'AGUARDANDO_USUARIO', minutos(20))).toEqual({
            acao: 'pausar',
            pausadoEm: minutos(20),
        })
    })

    it('EM ESPERA não pausa: a engenharia é nossa e o tempo dela conta', () => {
        expect(aoMudarStatus(relogio(), 'EM_ESPERA', minutos(20))).toBe(null)
    })

    it('a retomada empurra o vencimento pelo tempo exato parado', () => {
        /**
         * O defeito que esta prova existe para impedir: sem empurrar, um
         * chamado que ficou três dias aguardando o usuário volta já violado,
         * por culpa de quem esperávamos.
         */
        const pausado = relogio({ pausadoEm: minutos(20) })
        const tresDias = 3 * 24 * 60

        const mudanca = aoMudarStatus(pausado, 'ABERTO', minutos(20 + tresDias))

        expect(mudanca).toEqual({ acao: 'retomar', venceEm: minutos(60 + tresDias) })
    })

    it('o prazo não anda duas vezes: só a retomada empurra', () => {
        /// Somar na pausa E na retomada dobraria o prazo sem nenhum sintoma
        /// visível até alguém conferir os números à mão.
        const naPausa = aoMudarStatus(relogio(), 'AGUARDANDO_USUARIO', minutos(20))

        expect(naPausa).toEqual({ acao: 'pausar', pausadoEm: minutos(20) })
        expect(naPausa).not.toHaveProperty('venceEm')
    })

    it('pausar o que já está pausado, ou retomar o que anda, não faz nada', () => {
        const pausado = relogio({ pausadoEm: minutos(20) })

        expect(aoMudarStatus(pausado, 'RESOLVIDO', minutos(30))).toBe(null)
        expect(aoMudarStatus(relogio(), 'ABERTO', minutos(30))).toBe(null)
    })

    it('relógio final não se mexe mais', () => {
        const cumprido = relogio({ cumpridoEm: minutos(5) })
        const violado = relogio({ violadoEm: minutos(61) })

        expect(aoMudarStatus(cumprido, 'AGUARDANDO_USUARIO', minutos(70))).toBe(null)
        expect(aoMudarStatus(violado, 'ABERTO', minutos(70))).toBe(null)
    })

    it('o ciclo inteiro fecha: pausa, espera, retoma, vence no lugar certo', () => {
        let r = relogio()

        const pausa = aoMudarStatus(r, 'AGUARDANDO_USUARIO', minutos(20))
        r = { ...r, pausadoEm: (pausa as { pausadoEm: Date }).pausadoEm }
        expect(estadoDoRelogio(r, minutos(5000))).toBe('pausado')

        const retoma = aoMudarStatus(r, 'ABERTO', minutos(5000))
        r = { ...r, pausadoEm: null, venceEm: (retoma as { venceEm: Date }).venceEm }

        /**
         * Faltavam 40 minutos quando parou. Depois de retomar, faltam 40 —
         * nem mais, nem menos. Aos 39 ainda não venceu (está em risco, porque
         * resta 1 minuto de uma meta de 60); aos 40, venceu.
         */
        expect(restanteMs(r, minutos(5000))).toBe(40 * 60_000)
        expect(estadoDoRelogio(r, minutos(5000 + 39))).not.toBe('vencido')
        expect(estadoDoRelogio(r, minutos(5000 + 40))).toBe('vencido')
    })
})

describe('o cão de guarda', () => {
    it('dispara só na primeira resposta vencida', () => {
        /**
         * Mais estreito que "SLA violado" de propósito: violar a resolução
         * significa que o problema é difícil; violar a primeira resposta
         * significa que ninguém olhou.
         */
        const primeira = relogio({ meta: 'primeira_resposta' })
        const resolucao = relogio({ meta: 'resolucao' })

        expect(pedeCaoDeGuarda(primeira, minutos(61))).toBe(true)
        expect(pedeCaoDeGuarda(resolucao, minutos(61))).toBe(false)
    })

    it('não dispara em dia, pausado, cumprido nem já violado', () => {
        expect(pedeCaoDeGuarda(relogio(), minutos(10))).toBe(false)
        expect(pedeCaoDeGuarda(relogio({ pausadoEm: minutos(10) }), minutos(999))).toBe(false)
        expect(pedeCaoDeGuarda(relogio({ cumpridoEm: minutos(10) }), minutos(999))).toBe(false)
        /// Já violado não dispara de novo: o aviso sai uma vez.
        expect(pedeCaoDeGuarda(relogio({ violadoEm: minutos(61) }), minutos(999))).toBe(false)
    })

    it('a fração de risco é a declarada', () => {
        expect(FRACAO_DE_RISCO).toBe(0.2)
    })
})
