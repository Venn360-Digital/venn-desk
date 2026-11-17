import { Hono } from 'hono'
import { z } from 'zod'

import { abrirChamado } from '../dados/abertura.ts'
import { appsAtivos } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { formatarNumero } from '../dominio/numero.ts'
import { ErroDeDominio } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { avisarPorEmail } from '../correio/avisar.ts'
import { comApp, comCliente } from '../auth/middleware.ts'

/**
 * A API pública da página de status (seção 7, itens 1 e 2).
 *
 * **É a única parte do Venn Desk sem autenticação alguma**, e isso é
 * deliberado: ela existe para o momento em que o app não abre nem a tela de
 * login. Por isso o que ela devolve é o mínimo — nome do app, de pé ou não,
 * desde quando, e os últimos episódios. Nenhum chamado, nenhum nome de
 * cliente, nenhum e-mail, nenhum endereço interno.
 *
 * **A página que o cliente abre não é esta.** A página é estática e mora no
 * GitHub Pages, fora da Cloudflare, porque uma pane da Cloudflare derruba o
 * Venn Desk junto com os apps. Este endpoint é a fonte do build daquela
 * página, e a leitura ao vivo de quem conseguir alcançá-la.
 */
export const rotasDeStatus = new Hono<Ambiente>()

/**
 * CORS, só aqui e só para as origens da página de status.
 *
 * É necessário porque a página é servida de OUTRO fornecedor — é o ponto todo
 * dela — e um navegador não deixa `github.io` ler `workers.dev` sem isto.
 *
 * **E é importante não confundir o que CORS faz.** Ele não protege o endpoint:
 * qualquer cliente que não seja navegador ignora CORS, e a defesa do `/afetado`
 * é outra (teto por e-mail no rate limiter, resposta idêntica para e-mail
 * conhecido e desconhecido, nenhuma criação de usuário). O que a lista de
 * origens faz é impedir que uma página de terceiro use o formulário em nome do
 * visitante dela — e deixar visível, no código, de onde o formulário é servido.
 */
function origensPermitidas(env: Ambiente['Bindings']): string[] {
    return (env.ORIGENS_DO_STATUS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o !== '')
}

rotasDeStatus.use('/api/status/*', async (c, next) => {
    const origem = c.req.header('Origin')
    const permitida = origem !== undefined && origensPermitidas(c.env).includes(origem)

    /// O preflight responde sem tocar no banco: ele é feito antes do POST e
    /// não precisa saber nada sobre o app.
    if (c.req.method === 'OPTIONS') {
        if (!permitida) return c.body(null, 403)
        return c.body(null, 204, {
            'Access-Control-Allow-Origin': origem,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
        })
    }

    await next()

    if (permitida) {
        c.res.headers.set('Access-Control-Allow-Origin', origem)
        /// Sem `Vary: Origin` a borda serviria a uma origem a resposta cacheada
        /// da outra — e a resposta carrega o cabeçalho que autoriza.
        c.res.headers.append('Vary', 'Origin')
    }
})

rotasDeStatus.use('/api/status', comCliente)
rotasDeStatus.use('/api/status/:app', comCliente, comApp)
rotasDeStatus.use('/api/status/:app/afetado', comCliente, comApp)

/// Cabeçalhos de uma resposta pública de status: curta no cache da borda, mas
/// cacheável — num incidente, é a hora em que mais gente pede a mesma coisa.
const CACHE = { 'Cache-Control': 'public, max-age=30' }

rotasDeStatus.get('/api/status', async (c) => {
    const cliente = c.get('cliente')
    const apps = await appsAtivos(cliente)

    const linhas = await Promise.all(
        apps.map(async (app) => {
            const escopo = escopoDoApp(cliente, app.id)
            const [estado, episodio] = await Promise.all([
                escopo.saude.estado(),
                escopo.saude.episodioAberto(),
            ])

            return {
                app: app.slug,
                nome: app.nome,
                url: app.urlApp,
                /**
                 * `null` quando a verificação nunca rodou para este app — que é
                 * diferente de "de pé". Dizer "operacional" sobre o que não se
                 * mediu é o jeito mais rápido de uma página de status perder a
                 * razão de existir.
                 */
                estado: estado === null ? null : estado.saudavel ? 'operacional' : 'fora_do_ar',
                desdeEm: estado?.desdeEm ?? null,
                verificadoEm: estado?.verificadoEm ?? null,
                incidente:
                    episodio === null
                        ? null
                        : { iniciadoEm: episodio.iniciadoEm, detalhe: episodio.detalhe },
            }
        })
    )

    return c.json({ geradoEm: new Date().toISOString(), apps: linhas }, 200, CACHE)
})

rotasDeStatus.get('/api/status/:app', async (c) => {
    const app = c.get('app')
    const escopo = c.get('escopo')

    const [estado, episodios] = await Promise.all([
        escopo.saude.estado(),
        escopo.saude.episodios(10),
    ])

    return c.json(
        {
            app: app.slug,
            nome: app.nome,
            url: app.urlApp,
            estado: estado === null ? null : estado.saudavel ? 'operacional' : 'fora_do_ar',
            desdeEm: estado?.desdeEm ?? null,
            verificadoEm: estado?.verificadoEm ?? null,
            episodios: episodios.map((e) => ({
                iniciadoEm: e.iniciadoEm,
                terminadoEm: e.terminadoEm,
                detalhe: e.detalhe,
            })),
        },
        200,
        CACHE
    )
})

const esquemaDoAfetado = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
})

/**
 * "Também fui afetado" (seção 7, item 2).
 *
 * **A resposta é a MESMA para e-mail conhecido e desconhecido.** Este é um
 * endpoint público: devolver "não encontrei esse e-mail" o transformaria em
 * oráculo de quem é cliente de qual app, respondendo uma pergunta que ninguém
 * tem o direito de fazer daqui. Quem está cadastrado recebe o aviso por e-mail
 * e vê o chamado em "Meus chamados"; quem não está vê a mesma frase e nada
 * acontece. Nenhum caminho aqui cria usuário: a seção 7 é explícita em que
 * nenhum deles aceita usuário anônimo.
 */
rotasDeStatus.post('/api/status/:app/afetado', async (c) => {
    const app = c.get('app')
    const escopo = c.get('escopo')

    const corpo = esquemaDoAfetado.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('email_invalido', 'Informe um e-mail válido.', 400)
    }

    /// Teto por app e por e-mail: endpoint público e sem login é alvo natural.
    const { success } = await c.env.ABERTURA_RATE_LIMITER.limit({
        key: `afetado:${app.slug}:${corpo.data.email}`,
    })
    if (!success) {
        throw new ErroDeDominio('muitas_tentativas', 'Tente novamente em um minuto.', 429)
    }

    const RECIBO = {
        registrado: true,
        mensagem:
            'Se este e-mail estiver cadastrado, você receberá um aviso quando o problema for resolvido.',
    }

    const episodio = await escopo.saude.episodioAberto()
    /// Sem incidente aberto não há a que se ligar. Mesma resposta, de novo: não
    /// é tarefa desta rota contar a quem perguntar se o app está bem.
    if (episodio === null) return c.json(RECIBO)

    const solicitante = await escopo.solicitantes.porEmail(corpo.data.email)
    if (solicitante === null) return c.json(RECIBO)

    /**
     * Um chamado por pessoa por incidente. Sem isto, recarregar a página de
     * status vira uma fila de chamados idênticos no minuto em que a equipe mais
     * precisa que a fila seja legível.
     */
    const jaAbriu = await escopo.chamados.listar({
        requesterId: solicitante.id,
        status: ['NOVO', 'ABERTO', 'AGUARDANDO_USUARIO', 'EM_ESPERA'],
        limite: 50,
    })
    if (
        episodio.problemId !== null &&
        jaAbriu.some((chamado) => chamado.problemId === episodio.problemId)
    ) {
        return c.json(RECIBO)
    }

    const chamado = await abrirChamado(c.get('cliente'), app.id, {
        tenantId: solicitante.tenantId,
        requesterId: solicitante.id,
        assunto: `${app.nome} indisponível`,
        descricao:
            `Relatado pela página de status: "também fui afetado".\n\n` +
            `Incidente em aberto desde ${episodio.iniciadoEm.toISOString()}.`,
        tipo: 'INCIDENTE',
        prioridade: 'URGENTE',
        origem: 'PORTAL',
        ...(episodio.problemId === null ? {} : { problemId: episodio.problemId }),
        ator: 'sistema',
    })

    avisarPorEmail(c, 'abertura', {
        id: chamado.id,
        numero: chamado.numero,
        assunto: chamado.assunto,
        requesterId: solicitante.id,
        contexto: null,
    })

    return c.json({ ...RECIBO, numero: formatarNumero(app.prefixo, chamado.numero) })
})
