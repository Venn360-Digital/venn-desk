import { describe, expect, it } from 'vitest'

import { explicarRecusa, podeMesclar, textoDaMesclagem, type ChamadoParaMesclar } from './mesclar.ts'

function chamado(ajustes: Partial<ChamadoParaMesclar> = {}): ChamadoParaMesclar {
    return {
        id: 'tkt-1',
        numero: 1042,
        tenantId: 'tn-1',
        status: 'ABERTO',
        excluidoEm: null,
        mescladoEmId: null,
        ...ajustes,
    }
}

const DESTINO = chamado({ id: 'tkt-2', numero: 1040 })

describe('podeMesclar', () => {
    it('aceita duas aberturas do mesmo assunto, na mesma empresa', () => {
        expect(podeMesclar(chamado(), DESTINO)).toEqual({ ok: true })
    })

    it('recusa entre empresas diferentes', () => {
        /**
         * Não é detalhe: apontar o chamado de uma empresa para o de outra
         * mandaria a pessoa a um lugar que ela não pode abrir. Quando o defeito
         * é o mesmo, o que agrupa é o PROBLEMA, não a mesclagem.
         */
        const deOutra = chamado({ id: 'tkt-9', tenantId: 'tn-2' })
        const r = podeMesclar(chamado(), deOutra)
        expect(r).toEqual({ ok: false, motivo: 'tenant_diferente' })
        expect(explicarRecusa('tenant_diferente')).toContain('vínculo de incidente')
    })

    it('recusa cadeia: o destino não pode ser duplicata', () => {
        /// Sem isso nasceria A → B → C, e quem abre A precisaria de dois saltos
        /// para achar a conversa.
        expect(podeMesclar(chamado(), { ...DESTINO, mescladoEmId: 'tkt-3' })).toEqual({
            ok: false,
            motivo: 'destino_mesclado',
        })
    })

    it('recusa mesclar em si mesmo, o já mesclado, o fechado e o excluído', () => {
        expect(podeMesclar(chamado(), chamado()).ok).toBe(false)
        expect(podeMesclar(chamado({ mescladoEmId: 'x' }), DESTINO)).toEqual({
            ok: false,
            motivo: 'origem_ja_mesclada',
        })
        /// Encerrar a origem apontando para um fechado deixaria as duas pontas
        /// sem caminho: ninguém responde no destino.
        expect(podeMesclar(chamado(), { ...DESTINO, status: 'FECHADO' })).toEqual({
            ok: false,
            motivo: 'destino_fechado',
        })
        expect(podeMesclar(chamado({ excluidoEm: new Date() }), DESTINO).ok).toBe(false)
        expect(podeMesclar(chamado(), { ...DESTINO, excluidoEm: new Date() }).ok).toBe(false)
    })

    it('mesclar num RESOLVIDO é permitido', () => {
        /// Resolvido ainda aceita resposta e reabre; é um destino legítimo.
        expect(podeMesclar(chamado(), { ...DESTINO, status: 'RESOLVIDO' })).toEqual({ ok: true })
    })
})

describe('textoDaMesclagem', () => {
    it('leva o número que a pessoa pode abrir, e oferece volta', () => {
        const texto = textoDaMesclagem('ODB-1040')
        expect(texto).toContain('ODB-1040')
        /// Se o caso dela for outro, ela precisa de um caminho de volta.
        expect(texto).toContain('reabrimos')
    })
})
