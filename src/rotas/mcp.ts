import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { appPorId } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { chavesPeloPrefixo, marcarUso, TAMANHO_DO_PREFIXO } from '../dados/mcp.ts'
import { conferirSenha } from '../auth/sessao-console.ts'
import { ErroDeDominio } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { comCliente } from '../auth/middleware.ts'
import { executarFerramenta } from '../mcp/executar.ts'
import { embutidorDoWorkersAi } from '../conhecimento/embeddings.ts'
import { ferramentasDoEscopo, paraOProtocolo, type Escopo } from '../mcp/ferramentas.ts'
import { saidaDeEngenharia } from '../slack/engenharia.ts'

/**
 * O servidor MCP do Venn Desk (seção 8, Fase 4).
 *
 * É a peça central do desenho: separa conversa interna de resposta ao cliente,
 * dá ao Claude só as ações permitidas, e serve os três consumidores com o mesmo
 * contrato — o agente pela API, o Claude no Slack e o Claude Code no terminal.
 *
 * **A credencial decide o app e o escopo.** Não há parâmetro de app em lugar
 * nenhum: a chave `vdk_sup_…` do Odontobox só alcança chamados do Odontobox, e
 * a do canal de suporte não enxerga as ferramentas de engenharia. Ver
 * `src/mcp/ferramentas.ts`, onde isso é verificado por prova.
 *
 * **JSON-RPC 2.0 sobre HTTP**, o transporte "streamable HTTP" do MCP no modo
 * mais simples: uma resposta JSON por requisição, sem SSE. O Venn Desk não
 * emite notificação ao cliente MCP nem precisa manter sessão — cada chamada se
 * resolve sozinha, e o estado mora no banco.
 */
export const rotasDoMcp = new Hono<Ambiente>()

const VERSAO_DO_PROTOCOLO = '2025-06-18'

const esquemaDoPedido = z.object({
    jsonrpc: z.literal('2.0'),
    id: z.union([z.string(), z.number()]).optional(),
    method: z.string(),
    params: z.record(z.string(), z.unknown()).optional(),
})

/** Erros do JSON-RPC. Os negativos são os do padrão. */
const ERRO = {
    pedidoInvalido: -32600,
    metodoDesconhecido: -32601,
    parametrosInvalidos: -32602,
    interno: -32603,
}

interface Credencial {
    appId: string
    escopo: Escopo
    keyId: string
}

/**
 * Confere a chave do cabeçalho.
 *
 * O prefixo estreita a busca; a conferência é PBKDF2, a mesma da senha do
 * Console. Chave revogada nem chega a ser comparada (ver `src/dados/mcp.ts`).
 */
async function credencialDoPedido(c: Context<Ambiente>): Promise<Credencial | null> {
    const cabecalho = c.req.header('Authorization') ?? ''
    const chave = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : ''

    if (chave.length < TAMANHO_DO_PREFIXO + 8) return null

    const candidatas = await chavesPeloPrefixo(
        c.get('cliente'),
        chave.slice(0, TAMANHO_DO_PREFIXO)
    )

    for (const candidata of candidatas) {
        if (await conferirSenha(chave, candidata.hash)) {
            return {
                appId: candidata.appId,
                escopo: candidata.escopo as Escopo,
                keyId: candidata.id,
            }
        }
    }

    return null
}

rotasDoMcp.post('/mcp', comCliente, async (c) => {
    const cliente = c.get('cliente')

    const credencial = await credencialDoPedido(c)
    if (credencial === null) {
        /**
         * 401 com `WWW-Authenticate`, e a mensagem não diz se a chave é
         * desconhecida, revogada ou mal formada: as três têm a mesma resposta.
         */
        return c.json({ erro: { codigo: 'credencial_invalida', mensagem: 'Chave inválida.' } }, 401, {
            'WWW-Authenticate': 'Bearer realm="venn-desk-mcp"',
        })
    }

    const corpo = esquemaDoPedido.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        return c.json({
            jsonrpc: '2.0',
            id: null,
            error: { code: ERRO.pedidoInvalido, message: 'JSON-RPC 2.0 inválido.' },
        })
    }

    const { method, params, id } = corpo.data

    /**
     * Notificação não tem `id` e não leva resposta — é o que o padrão manda, e
     * `notifications/initialized` é a única que o cliente MCP manda no começo
     * de toda sessão. Responder a ela com um resultado faria clientes
     * rigorosos derrubarem a conexão.
     */
    if (id === undefined) return c.body(null, 202)

    const responder = (result: unknown) => c.json({ jsonrpc: '2.0', id, result })
    const falhar = (code: number, message: string) =>
        c.json({ jsonrpc: '2.0', id, error: { code, message } })

    if (method === 'initialize') {
        return responder({
            protocolVersion: VERSAO_DO_PROTOCOLO,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'venn-desk', version: '1.0.0' },
        })
    }

    if (method === 'tools/list') {
        return responder({
            tools: ferramentasDoEscopo(credencial.escopo).map(paraOProtocolo),
        })
    }

    if (method === 'tools/call') {
        const nome = params?.['name']
        const argumentos = (params?.['arguments'] ?? {}) as Record<string, unknown>

        if (typeof nome !== 'string') {
            return falhar(ERRO.parametrosInvalidos, 'Falta o nome da ferramenta.')
        }

        const app = await appPorId(cliente, credencial.appId)
        if (app === null) return falhar(ERRO.interno, 'App da credencial não existe mais.')

        /// O uso é marcado ANTES de executar: saber que a chave foi usada
        /// importa mesmo quando a ferramenta falhar.
        await marcarUso(cliente, credencial.keyId)

        try {
            const resultado = await executarFerramenta(
                {
                    cliente,
                    escopoDoApp: escopoDoApp(cliente, app.id),
                    app,
                    escopo: credencial.escopo,
                    ...(c.env.AI === undefined ? {} : { embutir: embutidorDoWorkersAi(c.env.AI) }),
                    abrirEngenharia: saidaDeEngenharia(escopoDoApp(cliente, app.id), app, c.env),
                },
                nome,
                argumentos
            )

            /**
             * Erro de ferramenta volta como RESULTADO com `isError`, não como
             * erro do protocolo. É o que o MCP especifica, e é o que permite ao
             * modelo ler o motivo e tentar outro caminho — um erro de JSON-RPC
             * encerra a chamada sem lhe dizer nada.
             */
            return responder({
                content: [{ type: 'text', text: resultado.texto }],
                ...(resultado.erro === true ? { isError: true } : {}),
            })
        } catch (erro) {
            if (erro instanceof ErroDeDominio) {
                return responder({
                    content: [{ type: 'text', text: erro.message }],
                    isError: true,
                })
            }

            console.error('[mcp] falha ao executar', nome, erro)
            /// Nada do erro interno vai para o modelo: ele seria copiado para
            /// uma thread do Slack junto com o resto da resposta.
            return responder({
                content: [{ type: 'text', text: 'A ferramenta falhou. Tente de novo.' }],
                isError: true,
            })
        }
    }

    return falhar(ERRO.metodoDesconhecido, `Método "${method}" não é suportado.`)
})

/**
 * O GET existe para dar uma resposta honesta a quem abrir a URL no navegador —
 * e para o transporte "streamable HTTP", em que o GET abriria um canal SSE que
 * este servidor não usa.
 */
rotasDoMcp.get('/mcp', (c) =>
    c.json(
        {
            servidor: 'venn-desk',
            protocolo: VERSAO_DO_PROTOCOLO,
            transporte: 'JSON-RPC 2.0 por POST. Este servidor não abre canal SSE.',
        },
        405,
        { Allow: 'POST' }
    )
)
