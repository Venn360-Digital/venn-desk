import { getCookie } from 'hono/cookie'
import { createMiddleware } from 'hono/factory'
import type { JWK } from 'jose'

import { appPorSlug } from '../dados/apps.ts'
import { criarCliente, descartarCliente } from '../dados/cliente.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { ErroDeDominio, ErroDeToken } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'

import { lerSessao } from './sessao-console.ts'
import { validarTokenDoApp } from './token-app.ts'

/**
 * Um cliente do Prisma por requisição, fechado no fim — sempre, inclusive
 * quando a rota lança. Ver o cabeçalho de `src/dados/cliente.ts`: sem o
 * `$disconnect()` a invocação fica pendurada segurando conexão no Neon.
 */
export const comCliente = createMiddleware<Ambiente>(async (c, next) => {
    const cliente = criarCliente(c.env.DATABASE_URL)
    c.set('cliente', cliente)

    try {
        await next()
    } finally {
        await descartarCliente(cliente)
    }
})

/**
 * Resolve o app do caminho e monta o escopo.
 *
 * O slug vem da URL, e não de uma claim do token: para buscar a chave que
 * valida o token seria preciso ler o token antes de validá-lo, e nada lido de um
 * token não verificado decide coisa alguma.
 */
export const comApp = createMiddleware<Ambiente>(async (c, next) => {
    const slug = c.req.param('app')
    if (slug === undefined || slug === '') {
        throw new ErroDeDominio('app_nao_informado', 'App não informado.', 400)
    }

    const app = await appPorSlug(c.get('cliente'), slug)
    if (app === null) {
        /// 404 e não 403: a existência de um app não é confirmada a quem pergunta.
        throw new ErroDeDominio('app_nao_encontrado', 'App não encontrado.', 404)
    }

    c.set('app', app)
    c.set('escopo', escopoDoApp(c.get('cliente'), app.id))

    await next()
})

/** O token assinado pelo app (ADR 0003), e o solicitante criado a partir dele. */
export const comTokenDoApp = createMiddleware<Ambiente>(async (c, next) => {
    const cabecalho = c.req.header('Authorization') ?? ''
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : ''

    if (token === '') {
        throw new ErroDeToken('token_ausente', 'Entre no app para abrir um chamado.')
    }

    const app = c.get('app')
    const identidade = await validarTokenDoApp(token, {
        slug: app.slug,
        chavePublicaJwk: app.chavePublicaJwk as JWK,
    })

    /**
     * Tenant e solicitante nascem das claims, a cada requisição. É o que permite
     * ao Desk nunca ler o banco do app e ainda assim ter nome, e-mail e tenant
     * atualizados — e é o que a seção 7 exige para o portal de contingência
     * reconhecer um e-mail conhecido quando o app estiver fora do ar.
     */
    const solicitante = await c.get('escopo').solicitantes.garantir({
        tenantExternalId: identidade.tenantExternalId,
        tenantNome: identidade.tenantExternalId,
        requesterExternalId: identidade.requesterExternalId,
        nome: identidade.nome,
        email: identidade.email,
        papelNoTenant: identidade.papelNoTenant,
        ...(identidade.plano === undefined ? {} : { plano: identidade.plano }),
    })

    c.set('identidade', identidade)
    c.set('solicitante', solicitante)

    await next()
})

/** A sessão do Console: cookie, ou Bearer para quem chama por script. */
export const comSessaoDeAgente = createMiddleware<Ambiente>(async (c, next) => {
    const cabecalho = c.req.header('Authorization') ?? ''
    const token = cabecalho.startsWith('Bearer ')
        ? cabecalho.slice(7).trim()
        : (getCookie(c, 'venn_desk_sessao') ?? '')

    if (token === '') {
        throw new ErroDeToken('sessao_ausente', 'Entre no Console.')
    }

    c.set('agente', await lerSessao(c.env.SEGREDO_SESSAO, token))

    await next()
})
