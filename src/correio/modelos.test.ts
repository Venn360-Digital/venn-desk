import { describe, expect, it } from 'vitest'

import { montar } from './modelos.ts'

const BASE = {
    numero: 'ODB-0042',
    assunto: 'A agenda não carrega',
    nomeDoApp: 'Odontobox360',
    nomeDoUsuario: 'Ana',
    link: 'https://app.exemplo/chamados/42',
    mensagens: [{ autor: 'Suporte', corpo: 'Era cache. Pode testar?' }],
}

describe('modelos de e-mail', () => {
    it('leva o número no assunto, nos três momentos', () => {
        for (const momento of ['abertura', 'atualizacao', 'encerramento'] as const) {
            expect(montar(momento, 'pt-BR', BASE).assunto).toContain('ODB-0042')
        }
    })

    it('traduz os três idiomas', () => {
        expect(montar('abertura', 'pt-BR', BASE).assunto).toContain('Recebemos')
        expect(montar('abertura', 'en', BASE).assunto).toContain('received')
        expect(montar('abertura', 'es', BASE).assunto).toContain('Recibimos')
    })

    /** E-mail só-HTML pesa contra a entrega de domínio sem reputação. */
    it('sempre manda parte texto, e ela carrega o link', () => {
        const { texto } = montar('atualizacao', 'pt-BR', BASE)
        expect(texto.length).toBeGreaterThan(50)
        expect(texto).toContain('https://app.exemplo/chamados/42')
    })

    it('avisa que o endereço não recebe resposta', () => {
        expect(montar('abertura', 'pt-BR', BASE).texto).toMatch(/não recebe respostas/i)
    })

    /**
     * O corpo carrega texto escrito por atendente e por usuário. Sem escape,
     * uma resposta com HTML viraria marcação no e-mail de outra pessoa.
     */
    it('escapa o que veio de gente no HTML', () => {
        const { html } = montar('atualizacao', 'pt-BR', {
            ...BASE,
            assunto: '<script>alert(1)</script>',
            mensagens: [{ autor: 'Suporte', corpo: 'veja <img src=x onerror=alert(1)>' }],
        })
        expect(html).not.toContain('<script>')
        expect(html).not.toContain('<img src=x')
        expect(html).toContain('&lt;script&gt;')
    })

    it('não inclui anexo nem endereço de ninguém', () => {
        const { texto, html } = montar('encerramento', 'pt-BR', BASE)
        expect(texto).not.toMatch(/@/)
        expect(html).not.toMatch(/anexo|attachment/i)
    })
})
