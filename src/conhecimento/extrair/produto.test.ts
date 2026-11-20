import { describe, expect, it } from 'vitest'

import { extrairProduto, SECOES_PUBLICAS } from './produto.ts'
import { fixture } from '../testes/fixtures.ts'

const PRODUCT = fixture('PRODUCT.md.txt')

describe('extrairProduto', () => {
    it('corta o PRODUCT.md real em seções numeradas', () => {
        const secoes = extrairProduto(PRODUCT)
        expect(secoes).toHaveLength(SECOES_PUBLICAS.length)
        expect(secoes[0]).toMatchObject({ numero: 1, titulo: 'Período de avaliação' })
        expect(secoes[0]?.corpo).toContain('avaliação')
    })

    it('as seções 13 e 14 NÃO entram: são decisão interna e inventário do que falta', () => {
        /**
         * A 14 diz que "plano ativo" significa "clicou no botão, não pagou".
         * Numa resposta a cliente isso seria desastroso — e é exatamente o tipo
         * de frase que um agente citaria se a tivesse.
         */
        const secoes = extrairProduto(PRODUCT)
        expect(secoes.map((s) => s.numero)).not.toContain(13)
        expect(secoes.map((s) => s.numero)).not.toContain(14)
        expect(secoes.map((s) => s.corpo).join(' ')).not.toContain('clicou no botão')
    })

    it('a lista é allowlist: uma seção 15 nova não é publicada sozinha', () => {
        const comNova = `${PRODUCT}\n\n## 15. Decisões de preço ainda em estudo\n\nUm texto qualquer com mais de quarenta caracteres para passar do piso.\n`
        expect(extrairProduto(comNova).map((s) => s.numero)).not.toContain(15)
    })

    it('corta seção enorme em linha inteira, e avisa', () => {
        const grande = `## 1. Grande\n\n${'uma linha de texto bem comprida para encher o limite inteiro\n'.repeat(400)}`
        const [secao] = extrairProduto(grande)
        expect(secao?.corpo.length).toBeLessThan(19_000)
        expect(secao?.corpo).toContain('(texto cortado por tamanho)')
        expect(secao?.corpo.split('\n').at(-1)).not.toMatch(/uma linha de texto bem comp$/)
    })

    it('arquivo sem seção numerada falha alto', () => {
        expect(() => extrairProduto('# Produto\n\nTexto solto.')).toThrow('nenhuma seção')
    })

    it('seção vazia é ignorada, não vira artigo de uma linha', () => {
        expect(() => extrairProduto('## 1. Vazia\n\n## 13. Interna\n\ntexto')).toThrow('nenhuma seção pública')
    })
})
