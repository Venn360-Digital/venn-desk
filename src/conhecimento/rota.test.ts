import { describe, expect, it } from 'vitest'

import { extrairVocabulario } from './extrair/vocabulario.ts'
import { nomeDaTela } from './rota.ts'
import { fixture } from './testes/fixtures.ts'

const MENU = {
    secoes: [{ rotulo: 'Vendas (CRM)', itens: [{ rotulo: '{{Servicos}}', href: '/vendas/servicos' }] }, { rotulo: 'x' }, { rotulo: 'y' }],
    segmentos: { vendas: 'Vendas', servicos: '{{Servicos}}', clientes: '{{Pessoas}}', campanhas: 'Campanhas', marketing: 'Marketing' },
}
const ODONTO = extrairVocabulario(fixture('brand-odontobox.ts.txt'))
const CONECTA = extrairVocabulario(fixture('brand-conecta.ts.txt'))

describe('nomeDaTela', () => {
    it('traduz a rota para o caminho do menu, no vocabulário do app', () => {
        expect(nomeDaTela('/vendas/servicos', MENU, ODONTO)).toBe('Vendas → Procedimentos')
        expect(nomeDaTela('/vendas/servicos', MENU, CONECTA)).toBe('Vendas → Serviços')
    })

    it('um id no caminho vira "(um item)", e a querystring é ignorada', () => {
        expect(nomeDaTela('/marketing/campanhas/cm3x9k2p1q8r7s6t5u4v3w2y?aba=1', MENU, ODONTO)).toBe('Marketing → Campanhas → (um item)')
    })

    it('rota sem nenhum segmento conhecido devolve null, não um palpite', () => {
        expect(nomeDaTela('/plataforma', MENU, ODONTO)).toBeNull()
        expect(nomeDaTela('/', MENU, ODONTO)).toBeNull()
    })
})
