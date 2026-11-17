import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { escopoDoApp } from '../dados/escopo.ts'
import { formatarNumero } from '../dominio/numero.ts'
import { grupoNoWidget, type Status } from '../dominio/estados.ts'
import { assinar, conferir } from '../lib/assinatura.ts'
import { ErroDeDominio } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import type { CaixaDeSaida } from '../correio/enviar.ts'
import { montarEntrada } from '../correio/portal.ts'
import type { Idioma } from '../correio/modelos.ts'
import { comApp, comCliente } from '../auth/middleware.ts'

/**
 * O portal de contingência (seção 7, item 3): a mesma central "Meus chamados",
 * fora do aplicativo, para quando o aplicativo não abre nem a tela de login.
 *
 * **Nenhum caminho aqui aceita usuário anônimo.** A seção 7 é explícita, e a
 * consequência de desenho é esta: o portal não tem cadastro, não tem senha e
 * não cria ninguém. Ele só reconhece — um e-mail que já chegou aqui pelo token
 * de um app, porque cada app informa nome, e-mail e tenant a cada login. Quem
 * nunca entrou no aplicativo não existe para o portal, e a resposta para esse
 * caso é idêntica à de quem existe.
 *
 * **O link é a credencial, e isso tem três consequências.**
 *
 *  1. Ele vale pouco tempo (`VALIDADE_DO_PORTAL_S`) e só para um solicitante de
 *     um app — a assinatura cobre os dois, como no link de anexo.
 *  2. Ele nunca abre o que o Console abre. O portal mostra o que o widget
 *     mostra: chamados daquele usuário, mensagens públicas. Nota interna,
 *     rascunho da IA e chamado de outra pessoa não passam por aqui.
 *  3. A página tira o token da barra de endereços assim que carrega. Link em
 *     histórico e em `Referer` é link vazado.
 */
export const rotasDoPortal = new Hono<Ambiente>()

/**
 * Trinta minutos: o link de anexo vale 5, porque é clicado no instante em que é
 * gerado. Este é clicado quando a pessoa encontra o e-mail, num momento em que
 * o produto dela está fora do ar — e um link expirado aí custa um segundo
 * pedido, um segundo e-mail e a confiança de quem já está irritado.
 */
export const VALIDADE_DO_PORTAL_S = 30 * 60

rotasDoPortal.use('/api/portal/app/:app/*', comCliente, comApp)

const esquemaDaEntrada = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    idioma: z.enum(['pt-BR', 'en', 'es']).optional(),
})

/** A chave assinada identifica o solicitante, e o propósito entra nela. */
const chaveDoPortal = (requesterId: string) => `portal:${requesterId}`

rotasDoPortal.post('/api/portal/app/:app/entrar', async (c) => {
    const app = c.get('app')
    const escopo = c.get('escopo')

    const corpo = esquemaDaEntrada.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('email_invalido', 'Informe um e-mail válido.', 400)
    }

    /// Teto por app e por e-mail. Sem isto, o portal vira uma forma de mandar
    /// e-mail em nome da Venn360 para qualquer endereço que alguém adivinhe.
    const { success } = await c.env.ABERTURA_RATE_LIMITER.limit({
        key: `portal:${app.slug}:${corpo.data.email}`,
    })
    if (!success) {
        throw new ErroDeDominio('muitas_tentativas', 'Tente novamente em um minuto.', 429)
    }

    /**
     * O MESMO recibo para e-mail conhecido e desconhecido, pela mesma razão do
     * "também fui afetado": dizer "não encontrei" aqui responderia, a quem não
     * provou nada, se um endereço é cliente de um produto.
     */
    const RECIBO = {
        enviado: true,
        mensagem: 'Se este e-mail estiver cadastrado, o link de acesso chegou na caixa dele.',
    }

    const solicitante = await escopo.solicitantes.porEmail(corpo.data.email)
    if (solicitante === null) return c.json(RECIBO)

    const destinatario = await escopo.solicitantes.porId(solicitante.id)
    if (destinatario === null) return c.json(RECIBO)

    const expiraEm = Math.floor(Date.now() / 1000) + VALIDADE_DO_PORTAL_S
    const token = await assinar(c.env.SEGREDO_LINKS, {
        appId: app.id,
        chave: chaveDoPortal(solicitante.id),
        expiraEm,
    })

    const urlBase = c.env.URL_BASE ?? 'https://venn-desk.andre-7ee.workers.dev'
    const link = `${urlBase}/portal/${app.slug}?u=${encodeURIComponent(solicitante.id)}&t=${encodeURIComponent(token)}`

    const { assunto, texto, html } = montarEntrada(corpo.data.idioma ?? 'pt-BR', {
        nomeDoApp: app.nome,
        nomeDoUsuario: destinatario.nome,
        link,
        minutos: Math.round(VALIDADE_DO_PORTAL_S / 60),
    })

    const caixa = c.env.EMAIL as unknown as CaixaDeSaida | undefined
    if (caixa !== undefined) {
        /// `waitUntil`: a resposta é a mesma de qualquer jeito, e prender quem
        /// pediu esperando o SMTP num momento de pane é o oposto do objetivo.
        c.executionCtx.waitUntil(
            caixa
                .send({
                    /// `name`, não `nome`: este objeto é a interface do
                    /// binding da Cloudflare, e o cast que eu tinha posto aqui
                    /// escondia a chave errada do compilador.
                    from: {
                        email: c.env.EMAIL_REMETENTE ?? 'suporte@mail.venn360.com',
                        name: `${app.nome} · Suporte`,
                    },
                    to: destinatario.email,
                    subject: assunto,
                    text: texto,
                    html,
                })
                .catch((erro: unknown) => {
                    const codigo = (erro as { code?: string }).code ?? 'desconhecido'
                    console.error('[portal] falha ao enviar link:', codigo)
                })
        )
    }

    return c.json(RECIBO)
})

/**
 * Valida o link e devolve de quem ele é. Toda rota de leitura passa por aqui —
 * o token não vira sessão, não vira cookie e não é guardado em lugar nenhum do
 * servidor: ele é conferido a cada requisição.
 */
async function solicitanteDoToken(c: Context<Ambiente>) {
    const requesterId = c.req.query('u') ?? ''
    const token = c.req.query('t') ?? ''

    if (requesterId === '' || token === '') {
        throw new ErroDeDominio('link_invalido', 'Link inválido ou expirado.', 401)
    }

    const valido = await conferir(c.env.SEGREDO_LINKS, {
        appId: c.get('app').id,
        chave: chaveDoPortal(requesterId),
        token,
    })

    /// Mesma mensagem para assinatura errada e para link vencido: a diferença
    /// entre as duas só interessa a quem está tentando forjar uma.
    if (!valido) throw new ErroDeDominio('link_invalido', 'Link inválido ou expirado.', 401)

    const quem = await c.get('escopo').solicitantes.porId(requesterId)
    if (quem === null) throw new ErroDeDominio('link_invalido', 'Link inválido ou expirado.', 401)

    return { requesterId, nome: quem.nome }
}

rotasDoPortal.get('/api/portal/app/:app/chamados', async (c) => {
    const app = c.get('app')
    const escopo = c.get('escopo')
    const quem = await solicitanteDoToken(c)

    /**
     * `requesterId` fixado no que o LINK diz, nunca no que a requisição pede.
     * É a mesma regra do widget: o administrador do tenant vê os chamados da
     * empresa lá porque o token do app o declara administrador. Aqui não há
     * token do app — há um link enviado a uma caixa —, então o portal mostra
     * só o que é da pessoa.
     */
    const chamados = await escopo.chamados.listar({ requesterId: quem.requesterId, limite: 50 })

    return c.json({
        app: { slug: app.slug, nome: app.nome, url: app.urlApp },
        usuario: { nome: quem.nome },
        chamados: chamados.map((chamado) => ({
            numero: formatarNumero(app.prefixo, chamado.numero),
            sequencial: chamado.numero,
            assunto: chamado.assunto,
            grupo: grupoNoWidget(chamado.status as Status),
            status: chamado.status,
            criadoEm: chamado.criadoEm,
            atualizadoEm: chamado.atualizadoEm,
        })),
    })
})

rotasDoPortal.get('/api/portal/app/:app/chamados/:numero', async (c) => {
    const app = c.get('app')
    const escopo = c.get('escopo')
    const quem = await solicitanteDoToken(c)

    const numero = Number(c.req.param('numero'))
    if (!Number.isInteger(numero)) {
        throw new ErroDeDominio('chamado_nao_encontrado', 'Chamado não encontrado.', 404)
    }

    const chamado = await escopo.chamados.porNumero(numero)
    /// O dono é conferido aqui e não na consulta de propósito: a resposta para
    /// "não existe" e para "não é seu" tem de ser a mesma.
    if (chamado === null || chamado.requesterId !== quem.requesterId) {
        throw new ErroDeDominio('chamado_nao_encontrado', 'Chamado não encontrado.', 404)
    }

    /// `publicas`: nota interna e rascunho da IA não existem para o portal.
    const mensagens = await escopo.mensagens.publicas(chamado.id)

    return c.json({
        chamado: {
            numero: formatarNumero(app.prefixo, chamado.numero),
            assunto: chamado.assunto,
            grupo: grupoNoWidget(chamado.status as Status),
            status: chamado.status,
            criadoEm: chamado.criadoEm,
        },
        mensagens: mensagens.map((m) => ({
            autor: m.autor,
            corpo: m.corpo,
            criadoEm: m.criadoEm,
        })),
    })
})
