import { describe, expect, it } from 'vitest'

import { fixture } from '../testes/fixtures.ts'

import { extrairVocabulario } from './vocabulario.ts'

describe('extrairVocabulario', () => {
    it('lê as dezesseis formas e o gênero do brand.ts real do Odontobox', () => {
        const v = extrairVocabulario(fixture('brand-odontobox.ts.txt'))
        expect(v.pessoa).toBe('paciente')
        expect(v.Pessoas).toBe('Pacientes')
        expect(v.Servicos).toBe('Procedimentos')
        expect(v.organizacao).toBe('clínica')
        expect(v.genero).toEqual({ organizacao: 'f', pessoa: 'm', profissional: 'm', servico: 'm' })
    })

    it('o Conecta e o Stagent dizem "cliente", não "paciente"', () => {
        for (const app of ['conecta', 'stagent']) {
            const v = extrairVocabulario(fixture(`brand-${app}.ts.txt`))
            expect(v.pessoa, app).toBe('cliente')
            expect(v.servico, app).toBe('serviço')
        }
    })

    it('falha ALTO quando falta uma chave, nomeando-a', () => {
        /// Publicar vocabulário incompleto espalharia "undefined" por todos os
        /// artigos do app. Melhor a sincronização parar nesta fonte.
        const quebrado = fixture('brand-odontobox.ts.txt').replace("Servicos: 'Procedimentos',", '')
        expect(() => extrairVocabulario(quebrado)).toThrow('Servicos')
    })

    it('não se perde com chaves aninhadas antes do bloco', () => {
        const texto = "const X = { a: { b: 'c' }, vocabulario: { genero: { organizacao: 'f', pessoa: 'm', profissional: 'm', servico: 'm' }, " +
            "organizacao: 'loja', Organizacao: 'Loja', organizacoes: 'lojas', Organizacoes: 'Lojas', pessoa: 'cliente', Pessoa: 'Cliente', pessoas: 'clientes', Pessoas: 'Clientes', " +
            "profissional: 'vendedor', Profissional: 'Vendedor', profissionais: 'vendedores', Profissionais: 'Vendedores', servico: 'serviço', Servico: 'Serviço', servicos: 'serviços', Servicos: 'Serviços' } }"
        expect(extrairVocabulario(texto).Pessoas).toBe('Clientes')
    })
})
