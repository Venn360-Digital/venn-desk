import type { Context } from 'hono'

import type { Ambiente } from '../lib/ambiente.ts'
import type { EscopoDoApp } from '../dados/escopo.ts'

import { enviarAviso, mensagensDesdeOUltimoAviso, type CaixaDeSaida } from './enviar.ts'
import type { Idioma, Momento } from './modelos.ts'

/**
 * A cola entre as rotas e o correio. Uma função, para nenhuma rota precisar
 * saber de remetente, idioma ou agrupamento.
 *
 * **Nunca no caminho da resposta.** O envio vai para `waitUntil`: o usuário não
 * espera o SMTP para ver o chamado criado, e uma lentidão do provedor de e-mail
 * não vira lentidão da tela.
 */
export function avisarPorEmail(
    c: Context<Ambiente>,
    momento: Momento,
    chamado: { id: string; numero: number; assunto: string; requesterId: string; contexto: unknown }
): void {
    const escopo = c.get('escopo')
    const app = c.get('app')

    const trabalho = (async () => {
        const destinatario = await escopo.solicitantes.porId(chamado.requesterId)
        if (destinatario === null) return

        const mensagens =
            momento === 'abertura' ? [] : await mensagensDesdeOUltimoAviso(escopo, chamado.id)

        /// Na atualização, sem mensagem nova não há o que avisar.
        if (momento === 'atualizacao' && mensagens.length === 0) return

        await enviarAviso({
            momento,
            escopo,
            caixa: c.env.EMAIL as unknown as CaixaDeSaida | undefined,
            remetente: {
                email: c.env.EMAIL_REMETENTE ?? 'suporte@mail.venn360.com',
                nome: `${app.nome} · Suporte`,
            },
            urlBase: c.env.URL_BASE ?? 'https://venn-desk.andre-7ee.workers.dev',
            app: { slug: app.slug, nome: app.nome, prefixo: app.prefixo },
            chamado: { id: chamado.id, numero: chamado.numero, assunto: chamado.assunto },
            destinatario,
            idioma: idiomaDoChamado(chamado.contexto),
            mensagens,
        })
    })()

    c.executionCtx.waitUntil(trabalho.catch(() => {}))
}

/**
 * O idioma sai do contexto que o widget capturou na abertura — é o único lugar
 * onde ele existe hoje. Preferência por usuário é cadastro, e entra na Fase 7;
 * até lá, quem abriu em espanhol recebe em espanhol, e o resto cai em pt-BR.
 */
function idiomaDoChamado(contexto: unknown): Idioma {
    if (typeof contexto !== 'object' || contexto === null) return 'pt-BR'
    const bruto = (contexto as { idioma?: unknown }).idioma
    if (typeof bruto !== 'string') return 'pt-BR'
    if (bruto.toLowerCase().startsWith('es')) return 'es'
    if (bruto.toLowerCase().startsWith('en')) return 'en'
    return 'pt-BR'
}
