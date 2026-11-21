import { describe, expect, it } from 'vitest'

import { anonimizar, dadosPessoaisEm } from './privacidade.ts'

const NOMES = ['Maria Antônia de Souza', 'Clínica São Jorge']

describe('anonimizar', () => {
    it('troca cada tipo por um rótulo e deixa a frase legível', () => {
        const texto =
            'Oi, sou a Maria Antônia da Clínica São Jorge. Meu email é maria.souza+clinica@gmail.com, ' +
            'telefone (11) 98765-4321, CPF 123.456.789-01, CNPJ 12.345.678/0001-99, CEP 01310-100. ' +
            'O link que recebi foi https://app.odontobox360.com/convite?token=abc123def456 e não abre.'
        const limpo = anonimizar(texto, NOMES)

        expect(limpo).toContain('[e-mail]')
        expect(limpo).toContain('[telefone]')
        expect(limpo).toContain('[CPF]')
        expect(limpo).toContain('[CNPJ]')
        expect(limpo).toContain('[CEP]')
        expect(limpo).toContain('[link]')
        expect(limpo).toContain('[nome]')
        /// O problema tem de sobreviver: é ele que vira artigo.
        expect(limpo).toContain('não abre')
        expect(limpo).not.toMatch(/maria\.souza|98765|456\.789|0001-99|01310-100|abc123def456/i)
        expect(dadosPessoaisEm(limpo, NOMES)).toEqual([])
    })

    it('acha o nome escrito sem acento, como o cliente escreve', () => {
        /// O cadastro diz "Antônia"; o chamado diz "antonia". Um replace do
        /// literal não acharia, e o nome seria publicado.
        expect(anonimizar('a antonia nao consegue entrar', NOMES)).toBe('a [nome] nao consegue entrar')
    })

    it('não apaga palavra curta nem preposição de nome', () => {
        /// "de" e "São" estão dentro de meio nome do Brasil e de metade das
        /// frases: substituí-los apagaria o texto do chamado.
        const limpo = anonimizar('de manhã a agenda de segunda não carrega', NOMES)
        expect(limpo).toBe('de manhã a agenda de segunda não carrega')
    })
})

describe('dadosPessoaisEm', () => {
    it('onze dígitos sem pontuação são ambíguos, e a guarda barra de todo jeito', () => {
        /**
         * Celular com DDD e CPF têm os mesmos 11 dígitos, e sem pontuação nada
         * os separa — os dois caem no detector de CPF. Para a guarda tanto faz:
         * o que decide é barrar, não classificar. Com pontuação, cada um vai
         * para o seu tipo, e é isso que o rótulo do texto anonimizado mostra.
         */
        expect(dadosPessoaisEm('o telefone é 11987654321')).toHaveLength(1)
        expect(dadosPessoaisEm('cpf 12345678901, sem pontos')).toHaveLength(1)
        expect(anonimizar('ligue (11) 98765-4321')).toBe('ligue [telefone]')
        expect(anonimizar('cpf 123.456.789-01')).toBe('cpf [CPF]')
    })

    it('a amostra da trilha não carrega o dado', () => {
        const achados = dadosPessoaisEm('escreve para joana@exemplo.com.br')
        expect(achados).toHaveLength(1)
        expect(achados[0]?.amostra).not.toContain('joana')
        expect(achados[0]?.amostra).not.toContain('exemplo')
    })

    it('texto sem dado pessoal passa limpo', () => {
        expect(dadosPessoaisEm('o convite expirou e preciso de outro', NOMES)).toEqual([])
        expect(dadosPessoaisEm('o chamado 1042 foi resolvido em 3 dias')).toEqual([])
    })
})
