import { describe, expect, it } from 'vitest'

import { montarEntrada } from './portal.ts'

const DADOS = {
    nomeDoApp: 'Odontobox360',
    nomeDoUsuario: 'Ana <Souza>',
    link: 'https://desk.venn360.com/portal/odontobox?u=abc&t=123.xyz',
    minutos: 30,
}

describe('o e-mail de acesso ao portal', () => {
    it('sai nas três línguas, com assunto e corpo próprios', () => {
        for (const idioma of ['pt-BR', 'en', 'es'] as const) {
            const { assunto, texto, html } = montarEntrada(idioma, DADOS)
            expect(assunto).toContain('Odontobox360')
            /// No texto puro o link vai cru: é o que a pessoa copia.
            expect(texto).toContain(DADOS.link)
            /**
             * No HTML ele vai com `&` escapado para `&amp;`, que é o correto
             * dentro de um atributo — e o que o cliente de e-mail decodifica de
             * volta. Afirmar o link cru aqui reprovaria o comportamento certo.
             */
            expect(html).toContain(`href="${DADOS.link.replace(/&/g, '&amp;')}"`)
        }
        expect(montarEntrada('en', DADOS).assunto).not.toEqual(
            montarEntrada('es', DADOS).assunto
        )
    })

    it('diz a validade e avisa para não repassar', () => {
        /// O link É a credencial. Um e-mail que não diz isso convida a
        /// encaminhá-lo para o colega que "também está sem o sistema".
        const { texto } = montarEntrada('pt-BR', DADOS)
        expect(texto).toContain('30 minutos')
        expect(texto).toMatch(/não o repasse/i)
    })

    it('não leva número nem assunto de chamado', () => {
        /**
         * Quando este e-mail é escrito, quem pediu ainda NÃO provou ser dono da
         * caixa — a prova é abrir a mensagem. Então ela não pode contar o que
         * há dentro da conta.
         */
        const { texto, html, assunto } = montarEntrada('pt-BR', DADOS)
        for (const parte of [texto, html, assunto]) {
            expect(parte).not.toMatch(/ODB-\d|chamado \d/i)
        }
    })

    it('escapa o nome no HTML e o deixa cru no texto', () => {
        const { texto, html } = montarEntrada('pt-BR', DADOS)
        expect(html).toContain('Ana &lt;Souza&gt;')
        expect(html).not.toContain('Ana <Souza>')
        expect(texto).toContain('Ana <Souza>')
    })

    it('leva parte texto além do HTML', () => {
        /// E-mail só-HTML pesa contra a entrega de um domínio sem reputação — e
        /// este é o que menos pode cair em spam: ele sai quando o app já caiu.
        const { texto } = montarEntrada('es', DADOS)
        expect(texto.length).toBeGreaterThan(80)
        /**
         * Nenhuma TAG — e a asserção precisa ser por nome de tag, não por
         * `<` seguido de letra: "Ana <Souza>" casaria com isso, e é texto
         * legítimo. O `<` cru é a prova de que esta parte NÃO passou pelo
         * escapador de HTML.
         */
        expect(texto).not.toMatch(/<\/?(html|body|div|p|a|br)\b/i)
        expect(texto).not.toContain('style=')
        expect(texto).toContain('Ana <Souza>')
    })
})
