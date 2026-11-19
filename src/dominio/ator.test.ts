import { describe, expect, it } from 'vitest'

import { lerAtor, resolverAtores } from './ator.ts'

describe('lerAtor', () => {
    it('separa tipo e id', () => {
        expect(lerAtor('agent:abc123')).toMatchObject({ tipo: 'agente', id: 'abc123' })
        expect(lerAtor('requester:xyz')).toMatchObject({ tipo: 'solicitante', id: 'xyz' })
    })

    it('a IA não tem id, e o sistema também não', () => {
        expect(lerAtor('ia:agente')).toMatchObject({ tipo: 'ia', id: '' })
        expect(lerAtor('cron')).toMatchObject({ tipo: 'sistema', id: '' })
        expect(lerAtor('fila:atendimento')).toMatchObject({ tipo: 'sistema', id: '' })
    })

    it('o id com dois-pontos no meio não é partido duas vezes', () => {
        /// `indexOf`, não `split`: um id que contenha `:` perderia a cauda.
        expect(lerAtor('agent:a:b')).toMatchObject({ tipo: 'agente', id: 'a:b' })
    })
})

describe('resolverAtores', () => {
    const buscar = {
        agentes: async (ids: string[]) =>
            ids.filter((id) => id === 'a1').map((id) => ({ id, nome: 'Ana Gestora' })),
        solicitantes: async (ids: string[]) =>
            ids.filter((id) => id === 's1').map((id) => ({ id, nome: 'Bia Cliente' })),
    }

    it('troca id por nome e nomeia quem não é pessoa', async () => {
        const mapa = await resolverAtores(['agent:a1', 'requester:s1', 'ia:agente', 'cron'], buscar)

        expect(mapa.get('agent:a1')?.nome).toBe('Ana Gestora')
        expect(mapa.get('requester:s1')?.nome).toBe('Bia Cliente')
        expect(mapa.get('ia:agente')?.nome).toBe('IA')
        expect(mapa.get('cron')?.nome).toBe('Sistema')
    })

    it('quem sumiu do cadastro continua aparecendo pelo id', async () => {
        /**
         * Agente desativado e solicitante removido continuam tendo feito o que
         * fizeram. Trocar por "desconhecido" apagaria o rastro de quem agiu, e a
         * trilha existe justamente para isso não acontecer.
         */
        const mapa = await resolverAtores(['agent:sumido'], buscar)

        expect(mapa.get('agent:sumido')?.nome).toBe('sumido')
    })

    it('consulta em LOTE: trinta eventos do mesmo agente não são trinta consultas', async () => {
        const chamadas: string[][] = []
        const espiao = {
            agentes: async (ids: string[]) => {
                chamadas.push(ids)
                return ids.map((id) => ({ id, nome: 'Ana' }))
            },
            solicitantes: async () => [],
        }

        const trilha = Array.from({ length: 30 }, () => 'agent:a1')
        await resolverAtores(trilha, espiao)

        expect(chamadas).toHaveLength(1)
        expect(chamadas[0]).toEqual(['a1'])
    })
})
