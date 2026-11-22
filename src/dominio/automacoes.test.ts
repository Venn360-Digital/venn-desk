import { describe, expect, it } from 'vitest'

import { decidirAutomacoes, PRAZOS_PADRAO, textoDoLembrete, type ChamadoParado } from './automacoes.ts'

const AGORA = new Date('2026-11-22T12:00:00Z')
const diasAtras = (d: number) => new Date(AGORA.getTime() - d * 24 * 60 * 60 * 1000)

function parado(ajustes: Partial<ChamadoParado> = {}): ChamadoParado {
    return {
        id: 'tkt-1',
        numero: 1042,
        status: 'AGUARDANDO_USUARIO',
        ultimaMensagemEm: diasAtras(4),
        resolvidoEm: null,
        jaLembrado: false,
        ...ajustes,
    }
}

describe('decidirAutomacoes', () => {
    it('lembra antes de resolver, sempre', () => {
        /**
         * Resolver sem lembrar encerraria o chamado de quem talvez não tenha
         * visto a resposta, e a pessoa descobriria pelo e-mail de
         * encerramento. O prazo de resolver só conta depois do lembrete.
         */
        const dezDias = parado({ ultimaMensagemEm: diasAtras(10), jaLembrado: false })
        expect(decidirAutomacoes([dezDias], AGORA)).toEqual([
            { chamadoId: 'tkt-1', numero: 1042, acao: 'lembrar', diasParado: 10 },
        ])

        const comLembrete = parado({ ultimaMensagemEm: diasAtras(10), jaLembrado: true })
        expect(decidirAutomacoes([comLembrete], AGORA)[0]?.acao).toBe('resolver_por_inatividade')
    })

    it('respeita os três prazos', () => {
        expect(decidirAutomacoes([parado({ ultimaMensagemEm: diasAtras(2) })], AGORA)).toEqual([])
        expect(decidirAutomacoes([parado({ ultimaMensagemEm: diasAtras(3) })], AGORA)[0]?.acao).toBe('lembrar')
        expect(
            decidirAutomacoes([parado({ ultimaMensagemEm: diasAtras(6), jaLembrado: true })], AGORA)
        ).toEqual([])
        expect(
            decidirAutomacoes([parado({ ultimaMensagemEm: diasAtras(7), jaLembrado: true })], AGORA)[0]?.acao
        ).toBe('resolver_por_inatividade')
    })

    it('fecha o resolvido depois do prazo de reabertura', () => {
        const resolvido = parado({ status: 'RESOLVIDO', resolvidoEm: diasAtras(5), ultimaMensagemEm: diasAtras(5) })
        expect(decidirAutomacoes([resolvido], AGORA)[0]).toMatchObject({ acao: 'fechar', diasParado: 5 })

        const recem = parado({ status: 'RESOLVIDO', resolvidoEm: diasAtras(1) })
        expect(decidirAutomacoes([recem], AGORA)).toEqual([])
    })

    it('chamado sem mensagem nenhuma não é resolvido por inatividade', () => {
        /**
         * Acontece com chamado movido à mão para "aguardando usuário" antes de
         * alguém escrever. Resolver esse encerraria um chamado que ninguém
         * respondeu.
         */
        expect(decidirAutomacoes([parado({ ultimaMensagemEm: null, jaLembrado: true })], AGORA)).toEqual([])
    })

    it('status que espera por NÓS não entra em automação', () => {
        /// Aberto, novo e em espera são trabalho da equipe. Fechá-los por
        /// inatividade esconderia a fila em vez de mostrá-la.
        for (const status of ['NOVO', 'ABERTO', 'EM_ESPERA', 'FECHADO']) {
            expect(decidirAutomacoes([parado({ status, ultimaMensagemEm: diasAtras(30) })], AGORA)).toEqual([])
        }
    })

    it('prazos podem ser trocados sem tocar na regra', () => {
        const curto = { lembreteEmDias: 1, resolverEmDias: 2, fecharEmDias: 1 }
        expect(decidirAutomacoes([parado({ ultimaMensagemEm: diasAtras(1) })], AGORA, curto)[0]?.acao).toBe('lembrar')
    })
})

describe('textoDoLembrete', () => {
    it('não cobra, não promete data, e diz o que fazer', () => {
        const texto = textoDoLembrete(3, PRAZOS_PADRAO.resolverEmDias)
        expect(texto).toContain('responda por aqui')
        expect(texto).toContain('reabri-lo quando quiser')
        /// Nenhuma data absoluta: "em 4 dias" é relativo e não envelhece.
        expect(texto).not.toMatch(/\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}/)
    })

    it('nunca diz "em 0 dias" nem número negativo', () => {
        /// O chamado pode passar do prazo antes de a automação rodar.
        expect(textoDoLembrete(9, 7)).toContain('em 1 dia(s)')
    })
})
