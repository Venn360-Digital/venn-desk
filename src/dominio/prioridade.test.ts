import { describe, expect, it } from 'vitest'

import { exigeHumano, prioridadeSugerida } from './prioridade.ts'

describe('prioridade sugerida', () => {
    it('tenant parado sem contorno é urgente', () => {
        expect(prioridadeSugerida('INCIDENTE', 'nao_consigo_trabalhar', 'sem_contorno')).toBe(
            'URGENTE'
        )
    })

    it('perda de dado nunca é baixa, mesmo afetando uma pessoa só', () => {
        expect(prioridadeSugerida('INCIDENTE', 'so_eu', 'perda_de_dado')).toBe('ALTA')
    })

    it('dúvida de uso não chega a urgente', () => {
        expect(prioridadeSugerida('DUVIDA', 'nao_consigo_trabalhar', 'sem_contorno')).toBe('ALTA')
    })

    it('solicitação de funcionalidade é baixa, qualquer que seja o impacto', () => {
        expect(prioridadeSugerida('SOLICITACAO', 'nao_consigo_trabalhar', 'perda_de_dado')).toBe(
            'BAIXA'
        )
    })

    it('incidente com contorno afetando uma pessoa é baixa', () => {
        expect(prioridadeSugerida('INCIDENTE', 'so_eu', 'tem_contorno')).toBe('BAIXA')
    })
})

describe('desvio para humano', () => {
    it('reconhece os motivos da seção 4', () => {
        expect(exigeHumano(['cobranca'])).toBe(true)
        expect(exigeHumano(['pedido_de_titular_lgpd'])).toBe(true)
        expect(exigeHumano(['vazamento_entre_tenants'])).toBe(true)
    })

    it('não desvia por motivo que não está na lista', () => {
        expect(exigeHumano([])).toBe(false)
        expect(exigeHumano(['usuario_irritado', 'botao_feio'])).toBe(false)
    })
})
