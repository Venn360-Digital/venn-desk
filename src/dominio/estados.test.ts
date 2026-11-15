import { describe, expect, it } from 'vitest'

import { ErroDeDominio } from '../lib/erros.ts'

import {
    ehImutavel,
    grupoNoWidget,
    proximoStatus,
    slaPausado,
    transicionar,
    type Status,
} from './estados.ts'

const TODOS: Status[] = [
    'NOVO',
    'ABERTO',
    'AGUARDANDO_USUARIO',
    'EM_ESPERA',
    'RESOLVIDO',
    'FECHADO',
]

describe('máquina de estados do chamado', () => {
    it('percorre o ciclo do critério de aceite da Fase 1: criar, responder, resolver, reabrir', () => {
        let status: Status = 'NOVO'
        status = transicionar(status, 'responder_usuario')
        expect(status).toBe('AGUARDANDO_USUARIO')

        status = transicionar(status, 'resolver')
        expect(status).toBe('RESOLVIDO')

        status = transicionar(status, 'mensagem_do_usuario')
        expect(status).toBe('ABERTO')
    })

    it('escala para engenharia e volta', () => {
        const emEspera = transicionar('ABERTO', 'escalar_engenharia')
        expect(emEspera).toBe('EM_ESPERA')
        expect(transicionar(emEspera, 'engenharia_concluida')).toBe('ABERTO')
    })

    it('resolve por inatividade só a partir de aguardando usuário', () => {
        expect(proximoStatus('AGUARDANDO_USUARIO', 'resolver_por_inatividade')).toBe('RESOLVIDO')
        expect(proximoStatus('ABERTO', 'resolver_por_inatividade')).toBeNull()
        expect(proximoStatus('EM_ESPERA', 'resolver_por_inatividade')).toBeNull()
    })

    it('fechado é imutável: nenhum evento sai dele', () => {
        expect(ehImutavel('FECHADO')).toBe(true)

        for (const evento of [
            'assumir',
            'responder_usuario',
            'mensagem_do_usuario',
            'escalar_engenharia',
            'engenharia_concluida',
            'resolver',
            'resolver_por_inatividade',
            'fechar',
        ] as const) {
            expect(proximoStatus('FECHADO', evento)).toBeNull()
        }
    })

    it('só resolvido pode fechar', () => {
        for (const status of TODOS) {
            const destino = proximoStatus(status, 'fechar')
            if (status === 'RESOLVIDO') expect(destino).toBe('FECHADO')
            else expect(destino).toBeNull()
        }
    })

    it('transição inválida lança ErroDeDominio, não corrige em silêncio', () => {
        expect(() => transicionar('NOVO', 'engenharia_concluida')).toThrowError(ErroDeDominio)
        expect(() => transicionar('FECHADO', 'resolver')).toThrowError(/fechado/i)
    })

    it('o relógio de SLA pausa com a bola no usuário, e não pausa em espera', () => {
        expect(slaPausado('AGUARDANDO_USUARIO')).toBe(true)
        expect(slaPausado('EM_ESPERA')).toBe(false)
        expect(slaPausado('NOVO')).toBe(false)
        expect(slaPausado('ABERTO')).toBe(false)
    })

    it('todo status cai em exatamente um dos três grupos do widget', () => {
        const grupos = TODOS.map(grupoNoWidget)
        expect(grupos).toEqual([
            'abertos',
            'abertos',
            'abertos',
            'em_andamento',
            'fechados',
            'fechados',
        ])
    })
})
