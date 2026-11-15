import { describe, expect, it } from 'vitest'

import { formatarNumero, lerNumero } from './numero.ts'

describe('número do chamado', () => {
    it('escreve como os exemplos da especificação', () => {
        expect(formatarNumero('ODB', 1042)).toBe('ODB-1042')
        expect(formatarNumero('CNT', 311)).toBe('CNT-0311')
        expect(formatarNumero('STG', 87)).toBe('STG-0087')
    })

    it('não trunca quando a sequência passa de quatro dígitos', () => {
        expect(formatarNumero('ODB', 123456)).toBe('ODB-123456')
    })

    it('recusa número que não é inteiro positivo', () => {
        expect(() => formatarNumero('ODB', 0)).toThrowError(/inteiro positivo/)
        expect(() => formatarNumero('ODB', -1)).toThrowError(/inteiro positivo/)
        expect(() => formatarNumero('ODB', 1.5)).toThrowError(/inteiro positivo/)
    })

    it('lê de volta o que escreveu', () => {
        expect(lerNumero('CNT-0311')).toEqual({ prefixo: 'CNT', numero: 311 })
        expect(lerNumero('  odb-1042 ')).toEqual({ prefixo: 'ODB', numero: 1042 })
    })

    it('devolve nulo no que não é número de chamado', () => {
        for (const texto of ['', 'ODB', '1042', 'ODB-', 'ODB-0', 'minha tela não abre']) {
            expect(lerNumero(texto)).toBeNull()
        }
    })
})
