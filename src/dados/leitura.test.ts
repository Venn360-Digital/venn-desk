import { describe, expect, it } from 'vitest'

import { escopoDoApp } from './escopo.ts'
import { conexaoFalsa } from './testes/conexao-falsa.ts'

const AGORA = new Date('2026-11-23T18:00:00Z')
const ANTES = new Date('2026-11-23T17:00:00Z')
const DEPOIS = new Date('2026-11-23T17:30:00Z')

describe('marcarLeitura', () => {
    it('marca quando há mensagem nova do OUTRO lado', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': { lidoPeloSolicitanteEm: ANTES, lidoPeloAtendenteEm: null },
            'ticketMessage.findFirst': { criadoEm: DEPOIS },
            'ticket.updateMany': { count: 1 },
        })

        const quando = await escopoDoApp(conexao, 'app-1').chamados.marcarLeitura('tkt-1', 'solicitante', AGORA)

        expect(quando).toEqual(AGORA)
        const escrita = chamadas.find((c) => c.delegado === 'ticket' && c.metodo === 'updateMany')
        expect(escrita?.args.data).toEqual({ lidoPeloSolicitanteEm: AGORA })
        /// O solicitante é marcado pelas mensagens de IA, HUMANO e SISTEMA — o
        /// lembrete automático é algo que ele precisa ver.
        const consulta = chamadas.find((c) => c.delegado === 'ticketMessage' && c.metodo === 'findFirst')
        expect(JSON.stringify(consulta?.args)).toContain('SISTEMA')
    })

    it('NÃO escreve quando nada novo chegou', async () => {
        /**
         * Sem esta condição, cada abertura de tela seria uma escrita no banco —
         * e a tela do Console recarrega sozinha a cada vinte segundos.
         */
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': { lidoPeloSolicitanteEm: DEPOIS, lidoPeloAtendenteEm: null },
            'ticketMessage.findFirst': { criadoEm: ANTES },
        })

        expect(await escopoDoApp(conexao, 'app-1').chamados.marcarLeitura('tkt-1', 'solicitante', AGORA)).toBe(null)
        expect(chamadas.some((c) => c.metodo === 'updateMany')).toBe(false)
    })

    it('chamado sem mensagem do outro lado não marca nada', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': { lidoPeloSolicitanteEm: null, lidoPeloAtendenteEm: null },
            'ticketMessage.findFirst': null,
        })

        expect(await escopoDoApp(conexao, 'app-1').chamados.marcarLeitura('tkt-1', 'atendente', AGORA)).toBe(null)
        expect(chamadas.some((c) => c.metodo === 'updateMany')).toBe(false)
    })

    it('o atendente é marcado pelas mensagens do USUÁRIO', async () => {
        /// Cada lado é marcado pelo que o outro escreveu; a própria mensagem de
        /// alguém não precisa ser marcada como lida por ele.
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': { lidoPeloSolicitanteEm: null, lidoPeloAtendenteEm: null },
            'ticketMessage.findFirst': { criadoEm: DEPOIS },
            'ticket.updateMany': { count: 1 },
        })

        await escopoDoApp(conexao, 'app-1').chamados.marcarLeitura('tkt-1', 'atendente', AGORA)

        const consulta = chamadas.find((c) => c.delegado === 'ticketMessage' && c.metodo === 'findFirst')
        expect(JSON.stringify(consulta?.args)).toContain('USUARIO')
        expect(JSON.stringify(consulta?.args)).not.toContain('HUMANO')
        const escrita = chamadas.find((c) => c.delegado === 'ticket' && c.metodo === 'updateMany')
        expect(escrita?.args.data).toEqual({ lidoPeloAtendenteEm: AGORA })
    })

    it('rascunho não conta como mensagem a ler', async () => {
        /// O rascunho do modo sombra não saiu: marcar leitura por causa dele
        /// diria que o cliente viu algo que ninguém enviou.
        const { conexao, chamadas } = conexaoFalsa({
            'ticket.findFirst': { lidoPeloSolicitanteEm: null, lidoPeloAtendenteEm: null },
            'ticketMessage.findFirst': { criadoEm: DEPOIS },
            'ticket.updateMany': { count: 1 },
        })

        await escopoDoApp(conexao, 'app-1').chamados.marcarLeitura('tkt-1', 'solicitante', AGORA)

        const consulta = chamadas.find((c) => c.delegado === 'ticketMessage' && c.metodo === 'findFirst')
        expect(JSON.stringify(consulta?.args)).toContain('"rascunho":false')
    })

    it('chamado de outro app não é marcado', async () => {
        const { conexao } = conexaoFalsa({ 'ticket.findFirst': null })
        expect(await escopoDoApp(conexao, 'app-1').chamados.marcarLeitura('tkt-de-outro', 'atendente', AGORA)).toBe(null)
    })
})
