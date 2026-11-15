import { describe, expect, it } from 'vitest'

import {
    conferirSenha,
    criarSessao,
    hashDeSenha,
    lerSessao,
    podeAprovar,
} from './sessao-console.ts'

const SEGREDO = 'segredo-da-sessao'

describe('senha do Console', () => {
    it('confere a senha certa e recusa a errada', async () => {
        const hash = await hashDeSenha('senha-bem-longa-de-teste')

        await expect(conferirSenha('senha-bem-longa-de-teste', hash)).resolves.toBe(true)
        await expect(conferirSenha('senha-bem-longa-de-test', hash)).resolves.toBe(false)
        await expect(conferirSenha('', hash)).resolves.toBe(false)
    })

    it('gera sal novo a cada hash, então dois hashes da mesma senha diferem', async () => {
        const a = await hashDeSenha('mesma-senha')
        const b = await hashDeSenha('mesma-senha')

        expect(a).not.toBe(b)
        await expect(conferirSenha('mesma-senha', a)).resolves.toBe(true)
        await expect(conferirSenha('mesma-senha', b)).resolves.toBe(true)
    })

    it('recusa hash em formato desconhecido sem explodir', async () => {
        for (const hash of ['', 'senha-em-texto-puro', 'bcrypt$10$abc$def', 'pbkdf2$1$a$b']) {
            await expect(conferirSenha('qualquer', hash)).resolves.toBe(false)
        }
    })
})

describe('sessão do Console', () => {
    const agente = { id: 'agente-1', nome: 'Carla', papel: 'GESTOR' } as const

    it('vai e volta', async () => {
        const token = await criarSessao(SEGREDO, agente)
        await expect(lerSessao(SEGREDO, token)).resolves.toEqual(agente)
    })

    it('recusa sessão assinada por outro segredo', async () => {
        const token = await criarSessao('outro-segredo', agente)
        await expect(lerSessao(SEGREDO, token)).rejects.toThrowError(/sessão encerrada/i)
    })

    it('recusa token do app como se fosse sessão do Console', async () => {
        await expect(lerSessao(SEGREDO, 'nao-e-um-jwt')).rejects.toThrowError(/sessão encerrada/i)
    })
})

describe('quem aprova', () => {
    it('gestor e admin aprovam; agente não', () => {
        expect(podeAprovar({ id: '1', nome: 'a', papel: 'GESTOR' })).toBe(true)
        expect(podeAprovar({ id: '1', nome: 'a', papel: 'ADMIN' })).toBe(true)
        expect(podeAprovar({ id: '1', nome: 'a', papel: 'AGENTE' })).toBe(false)
    })
})
