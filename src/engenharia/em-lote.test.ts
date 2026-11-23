import { describe, expect, it } from 'vitest'

import { escopoDoApp } from '../dados/escopo.ts'
import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import { resolverIncidentesDoDefeito } from './em-lote.ts'

const AUTOR = { ator: 'agent:ag-1' }

function chamado(id: string, ajustes: Record<string, unknown> = {}) {
    return { id, numero: Number(id.replace(/\D/g, '')), problemId: 'pb-1', status: 'ABERTO', appId: 'app-1', ...ajustes }
}

describe('resolverIncidentesDoDefeito', () => {
    it('avisa e resolve só os chamados DAQUELE defeito que estão abertos', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'problem.findFirst': { id: 'pb-1', appId: 'app-1', titulo: 'agenda' },
            'ticket.findMany': [
                chamado('t1'),
                chamado('t2'),
                /// De outro defeito: não entra.
                chamado('t3', { problemId: 'pb-9' }),
                /// Já resolvido à mão: não entra.
                chamado('t4', { status: 'RESOLVIDO' }),
            ],
            'ticket.findFirst': { id: 't1', appId: 'app-1', status: 'ABERTO' },
            'ticketMessage.create': { id: 'm1', criadoEm: new Date() },
            'ticket.updateMany': { count: 1 },
        })

        const r = await resolverIncidentesDoDefeito({
            escopo: escopoDoApp(conexao, 'app-1'),
            problemaId: 'pb-1',
            texto: 'A recorrência voltou a criar todas as datas. Publicado hoje.',
            autor: AUTOR,
        })

        expect(r).toMatchObject({ avisados: 2, resolvidos: 2, recusados: [] })
        const mensagens = chamadas.filter((c) => c.delegado === 'ticketMessage' && c.metodo === 'create')
        expect(mensagens).toHaveLength(2)
        /// Pública e de humano: é alguém dizendo o que foi feito, não o sistema.
        expect(mensagens[0]?.args.data).toMatchObject({ visibilidade: 'PUBLICA', autor: 'HUMANO', autorId: 'ag-1' })
    })

    it('a mensagem vai ANTES da transição', async () => {
        /**
         * Resolver é o que dispara o e-mail de encerramento e o pedido de nota.
         * Sem a mensagem antes, o cliente receberia "seu chamado foi resolvido"
         * sem saber o que foi feito.
         */
        const { conexao, chamadas } = conexaoFalsa({
            'problem.findFirst': { id: 'pb-1', appId: 'app-1' },
            'ticket.findMany': [chamado('t1')],
            'ticket.findFirst': { id: 't1', appId: 'app-1', status: 'ABERTO' },
            'ticketMessage.create': { id: 'm1', criadoEm: new Date() },
            'ticket.updateMany': { count: 1 },
        })

        await resolverIncidentesDoDefeito({
            escopo: escopoDoApp(conexao, 'app-1'),
            problemaId: 'pb-1',
            texto: 'corrigido',
            autor: AUTOR,
        })

        const ordem = chamadas.map((c) => `${c.delegado}.${c.metodo}`)
        expect(ordem.indexOf('ticketMessage.create')).toBeLessThan(ordem.indexOf('ticket.updateMany'))
    })

    it('um chamado recusado não impede os outros', async () => {
        /// Quem reabriu entre a consulta e a escrita é recusado pela máquina de
        /// estados, e isso é resposta legítima.
        let primeira = true
        const { conexao } = conexaoFalsa({
            'problem.findFirst': { id: 'pb-1', appId: 'app-1' },
            'ticket.findMany': [chamado('t1'), chamado('t2')],
            'ticket.findFirst': () => {
                if (primeira) {
                    primeira = false
                    return null
                }
                return { id: 't2', appId: 'app-1', status: 'ABERTO' }
            },
            'ticketMessage.create': { id: 'm1', criadoEm: new Date() },
            'ticket.updateMany': { count: 1 },
        })

        const r = await resolverIncidentesDoDefeito({
            escopo: escopoDoApp(conexao, 'app-1'),
            problemaId: 'pb-1',
            texto: 'corrigido',
            autor: AUTOR,
        })

        expect(r?.resolvidos).toBe(1)
        expect(r?.recusados).toHaveLength(1)
        expect(r?.recusados[0]?.numero).toBe(1)
    })

    it('defeito de outro app não é resolvido aqui', async () => {
        const { conexao } = conexaoFalsa({ 'problem.findFirst': null })
        expect(
            await resolverIncidentesDoDefeito({
                escopo: escopoDoApp(conexao, 'app-1'),
                problemaId: 'pb-de-outro',
                texto: 'x',
                autor: AUTOR,
            })
        ).toBe(null)
    })

    it('defeito sem chamado aberto devolve zero, sem escrever', async () => {
        const { conexao, chamadas } = conexaoFalsa({
            'problem.findFirst': { id: 'pb-1', appId: 'app-1' },
            'ticket.findMany': [chamado('t4', { status: 'FECHADO' })],
        })

        const r = await resolverIncidentesDoDefeito({
            escopo: escopoDoApp(conexao, 'app-1'),
            problemaId: 'pb-1',
            texto: 'x',
            autor: AUTOR,
        })

        expect(r).toEqual({ avisados: 0, resolvidos: 0, recusados: [] })
        expect(chamadas.some((c) => c.metodo === 'create')).toBe(false)
    })
})
