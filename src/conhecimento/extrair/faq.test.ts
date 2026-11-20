import { describe, expect, it } from 'vitest'

import { fixture } from '../testes/fixtures.ts'

import { extrairFaq } from './faq.ts'

describe('extrairFaq', () => {
    it('lê os 5 grupos e as 28 perguntas da FAQ real do Odontobox', () => {
        const faq = extrairFaq(fixture('suporte-odontobox.page.tsx.txt'))
        expect(faq).not.toBeNull()
        expect(faq?.grupos).toHaveLength(5)
        expect(faq?.grupos.reduce((n, g) => n + g.itens.length, 0)).toBe(28)
        expect(faq?.grupos[0]?.grupo).toBe('Agente e WhatsApp')
        expect(faq?.grupos[0]?.itens[0]?.p).toBe('O agente parou de responder. O que houve?')
    })

    it('o resumo do grupo vem junto, mesmo quebrado em linha', () => {
        const faq = extrairFaq(fixture('suporte-odontobox.page.tsx.txt'))
        expect(faq?.grupos[0]?.resumo).toContain('Por que o agente parou')
    })

    it('a FAQ do Stagent extrai igual — a divergência é de CONTEÚDO, não de forma', () => {
        /// É esse par que `divergencias.ts` compara: mesma forma, textos que
        /// deveriam ser do nicho e não são.
        const faq = extrairFaq(fixture('suporte-stagent.page.tsx.txt'))
        expect(faq?.grupos).toHaveLength(5)
        const textos = faq?.grupos.flatMap((g) => g.itens.map((i) => i.r)).join(' ') ?? ''
        expect(textos).toContain('implante')
    })

    it('aspas escapadas dentro da resposta sobrevivem', () => {
        const texto = "const FAQ: X[] = [ { grupo: 'Geral', resumo: 'r', icone: Bot, itens: [ { p: 'O que é a \"fila geral\" do sistema?', r: 'É a fila que ninguém escolheu, dita \\'geral\\' por isso mesmo.' } ] } ]"
        const faq = extrairFaq(texto)
        expect(faq?.grupos[0]?.itens[0]?.r).toBe("É a fila que ninguém escolheu, dita 'geral' por isso mesmo.")
    })

    it('forma desconhecida devolve null, nunca adivinhação', () => {
        expect(extrairFaq('export default function Page() { return null }')).toBeNull()
        expect(extrairFaq("const FAQ: X[] = [ { grupo: 'Geral', itens: [] } ]")).toBeNull()
    })
})
