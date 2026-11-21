import { describe, expect, it } from 'vitest'

import { AGENCIA, ODONTO } from '../conhecimento/testes/vocabulario-falso.ts'
import { chavesDoRecorte, type LinhaDoBanco } from './recorte.ts'
import type { CasoDaBateria } from './bateria.ts'

function linha(slug: string, voc: unknown, chave: string, corpo: string): LinhaDoBanco {
    return { slug, chave, titulo: chave, corpo, resultado: { vocabulario: voc } }
}

function caso(id: string, texto: string, artigoEsperado?: string): CasoDaBateria {
    return {
        id,
        app: 'stagent',
        categoria: 'duvida',
        assunto: texto,
        mensagem: texto,
        gabarito: artigoEsperado === undefined ? { desfecho: 'respondeu' } : { desfecho: 'respondeu', artigoEsperado },
    }
}

const LINHAS = [
    /// Mesmo conteúdo, vocabulário diferente: NÃO diverge.
    linha('odontobox', ODONTO, 'derivado:tela:agenda', 'O paciente marca um procedimento.'),
    linha('stagent', AGENCIA, 'derivado:tela:agenda', 'O cliente marca um serviço.'),
    /// Conteúdo que sobra depois de dobrar: diverge.
    linha('odontobox', ODONTO, 'derivado:faq:prazo', 'O aviso chega em 24 horas.'),
    linha('stagent', AGENCIA, 'derivado:faq:prazo', 'O aviso chega em 48 horas.'),
]

describe('chavesDoRecorte', () => {
    it('mantém o caso do artigo que divergiu e corta o do artigo idêntico', () => {
        const r = chavesDoRecorte(LINHAS, 'stagent')
        expect(r.vale(caso('a', 'quando chega o aviso', 'derivado:faq:prazo'))).toBe(true)
        expect(r.vale(caso('b', 'onde eu marco um horario', 'derivado:tela:agenda'))).toBe(false)
    })

    it('mantém o caso cujo texto usa o vocabulário, que é o que muda a busca', () => {
        /// "procedimento" e "serviço" não são a mesma palavra para a busca por
        /// palavra, e foi aí que Conecta e Stagent ficaram abaixo do piso.
        const r = chavesDoRecorte(LINHAS, 'stagent')
        expect(r.vale(caso('c', 'como cadastro um serviço novo', 'derivado:tela:agenda'))).toBe(true)
        expect(r.vale(caso('d', 'onde vejo meus clientes', 'derivado:tela:agenda'))).toBe(true)
        /// E o vocabulário do OUTRO app não conta: aqui ninguém diz paciente.
        expect(r.vale(caso('e', 'onde vejo meus pacientes', 'derivado:tela:agenda'))).toBe(false)
    })

    it('sem material para comparar, roda a bateria INTEIRA', () => {
        /**
         * O pior desfecho possível para um aceite é recortar até zero e
         * "passar" sem medir nada. Acontece de verdade quando um app ainda não
         * tem sincronização concluída com o vocabulário no resultado.
         */
        const semVocabulario = LINHAS.map((l) => ({ ...l, resultado: null }))
        const r = chavesDoRecorte(semVocabulario, 'stagent')
        expect(r.vale(caso('f', 'qualquer coisa'))).toBe(true)
        expect(r.porque).toContain('inteira')

        const soUmApp = chavesDoRecorte(LINHAS.filter((l) => l.slug === 'stagent'), 'stagent')
        expect(soUmApp.vale(caso('g', 'qualquer coisa'))).toBe(true)
    })
})
