import { describe, expect, it } from 'vitest'

import { fixture } from '../testes/fixtures.ts'

import { extrairVocabulario } from '../extrair/vocabulario.ts'
import { palavrasEstranhas, resolverPlaceholders, substituirVocabulario } from './vocabulario.ts'

const ODONTO = extrairVocabulario(fixture('brand-odontobox.ts.txt'))
const CONECTA = extrairVocabulario(fixture('brand-conecta.ts.txt'))
const STAGENT = extrairVocabulario(fixture('brand-stagent.ts.txt'))

describe('resolverPlaceholders', () => {
    it('troca {{Pessoas}} pela palavra do app, e deixa o que não conhece', () => {
        expect(resolverPlaceholders('Vendas → {{Pessoas}} e {{outra}}', ODONTO)).toBe('Vendas → Pacientes e {{outra}}')
        expect(resolverPlaceholders('{{Pessoas}}', CONECTA)).toBe('Clientes')
    })
})

describe('substituirVocabulario', () => {
    it('traduz por fronteira de palavra, plural inteiro primeiro', () => {
        const t = 'A clínica atende pacientes; as clínicas vizinhas, não. Clínica-escola.'
        expect(substituirVocabulario(t, ODONTO, CONECTA)).toBe(
            'A empresa atende clientes; as empresas vizinhas, não. Empresa-escola.'
        )
    })

    it('não toca palavra que contém outra: "procedimentos" não vira "serviçoss"', () => {
        expect(substituirVocabulario('procedimentos e procedimento', ODONTO, CONECTA)).toBe('serviços e serviço')
    })
})

describe('palavrasEstranhas', () => {
    it('acusa "clínica" e "paciente" dentro do Stagent', () => {
        /// É o dano real da FAQ triplicada: texto odontológico no app de
        /// intercâmbio. O detector tem de ver isso.
        const texto = 'Como marco que a clínica atende num feriado? Avaliação 30 minutos, implante 120.'
        expect(palavrasEstranhas(texto, STAGENT, [ODONTO, CONECTA])).toEqual(['clinica'])
    })

    it('não acusa palavra que também é deste nicho', () => {
        /// "cliente" é do Conecta E do Stagent; dentro do Stagent não é
        /// estranha.
        expect(palavrasEstranhas('o cliente escreveu', STAGENT, [CONECTA])).toEqual([])
    })
})
