import { describe, expect, it } from 'vitest'

import { conexaoFalsa } from '../dados/testes/conexao-falsa.ts'
import { varrerCandidatosASugestao } from './varrer.ts'

const AGORA = new Date('2026-11-20T04:00:00Z')
const ONZE_DIAS = new Date('2026-11-09T12:00:00Z')

const APP = { id: 'app-1', slug: 'odontobox', nome: 'Odontobox360', excluidoEm: null }

function chamado(id: string, ajustes: Record<string, unknown> = {}) {
    return {
        id,
        numero: 1,
        assunto: 'a',
        tipo: 'DUVIDA',
        status: 'RESOLVIDO',
        resolvidoEm: ONZE_DIAS,
        tenant: { nome: 'T' },
        requester: { nome: 'R' },
        csat: { nota: 5 },
        messages: [
            { autor: 'USUARIO', corpo: 'como faço', visibilidade: 'PUBLICA', rascunho: false, criadoEm: ONZE_DIAS },
            { autor: 'HUMANO', corpo: 'assim', visibilidade: 'PUBLICA', rascunho: false, criadoEm: ONZE_DIAS },
        ],
        ...ajustes,
    }
}

function filaFalsa() {
    const enviadas: unknown[] = []
    return { enviadas, fila: { send: async (m: unknown) => void enviadas.push(m) } }
}

describe('varrerCandidatosASugestao', () => {
    it('enfileira o elegível e conta por que os outros ficaram fora', async () => {
        const { conexao } = conexaoFalsa({
            'app.findMany': [APP],
            'kbArticle.findMany': [],
            'ticket.findMany': [
                chamado('t1'),
                /// Resolvido pela IA sozinha: a base já respondia.
                chamado('t2', {
                    messages: [
                        { autor: 'USUARIO', corpo: 'x', visibilidade: 'PUBLICA', rascunho: false, criadoEm: ONZE_DIAS },
                        { autor: 'IA', corpo: 'y', visibilidade: 'PUBLICA', rascunho: false, criadoEm: ONZE_DIAS },
                    ],
                }),
                chamado('t3', { csat: { nota: 2 } }),
            ],
            'kbConsulta.findMany': [],
        })
        const { enviadas, fila } = filaFalsa()

        const acoes = await varrerCandidatosASugestao(conexao as never, { agora: AGORA, fila })

        expect(enviadas).toEqual([{ tipo: 'sugerir-de-chamado', appId: 'app-1', ticketId: 't1' }])
        expect(acoes[0]).toMatchObject({
            app: 'odontobox',
            chamadosEnfileirados: 1,
            recusas: { 'sem-resposta-de-humano': 1, 'nota-baixa': 1 },
        })
    })

    it('não enfileira de novo o chamado que já tem rascunho', async () => {
        /**
         * A idempotência do `criarSugerido` cobriria o duplicado, mas só depois
         * de pagar o modelo — e a varredura roda todo dia sobre os mesmos
         * trinta dias.
         */
        const { conexao } = conexaoFalsa({
            'app.findMany': [APP],
            'kbArticle.findMany': [{ id: 'a1', chave: 'sugerido:chamado:t1', origem: 'SUGERIDO' }],
            'ticket.findMany': [chamado('t1')],
            'kbConsulta.findMany': [],
        })
        const { enviadas, fila } = filaFalsa()

        await varrerCandidatosASugestao(conexao as never, { agora: AGORA, fila })

        expect(enviadas).toEqual([])
    })

    it('a lacuna vira mensagem a partir da terceira ocorrência', async () => {
        const consulta = (texto: string, dia: number) => ({
            texto,
            origem: 'agente',
            artigosDevolvidos: [],
            artigoLidoId: null,
            criadoEm: new Date(`2026-11-${String(dia).padStart(2, '0')}T10:00:00Z`),
        })
        const { conexao } = conexaoFalsa({
            'app.findMany': [APP],
            'kbArticle.findMany': [],
            'ticket.findMany': [],
            'kbConsulta.findMany': [
                consulta('como exportar a lista de pacientes', 10),
                consulta('exportar lista de pacientes para excel', 11),
                consulta('quero exportar os pacientes em planilha', 12),
                /// Duas vezes só: ainda é coincidência.
                consulta('mudar a cor do tema', 13),
                consulta('mudar a cor do tema do sistema', 14),
            ],
        })
        const { enviadas, fila } = filaFalsa()

        await varrerCandidatosASugestao(conexao as never, { agora: AGORA, fila })

        expect(enviadas).toHaveLength(1)
        expect(enviadas[0]).toMatchObject({ tipo: 'sugerir-de-lacuna', appId: 'app-1', vezes: 3 })
    })

    it('sem fila, não faz nada — nem consulta', async () => {
        const { conexao, chamadas } = conexaoFalsa({ 'app.findMany': [APP] })

        expect(await varrerCandidatosASugestao(conexao as never, { agora: AGORA, fila: undefined })).toEqual([])
        expect(chamadas).toHaveLength(0)
    })
})
