import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { abrirChamado } from '../dados/abertura.ts'
import { formatarNumero } from '../dominio/numero.ts'
import { grupoNoWidget, type GrupoNoWidget, type Status } from '../dominio/estados.ts'
import { prioridadeSugerida, type Impacto } from '../dominio/prioridade.ts'
import {
    atendidoPelaIa,
    esquemaDaNota,
    NOTA_MAXIMA,
    NOTA_MINIMA,
    podeAvaliar,
} from '../dominio/csat.ts'
import { NOTA_MINIMA_DO_CSAT } from '../conhecimento/sugerir.ts'
import { assinar, VALIDADE_DO_LINK_S } from '../lib/assinatura.ts'
import { ErroDeDominio } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { avisarPorEmail } from '../correio/avisar.ts'
import { avisarNoSlack, espelharNoSlack } from '../slack/espelhar.ts'
import { duplicadosProvaveis, tipoSugerido, type SinaisDoContexto } from '../dominio/triagem.ts'
import { etapaParaOCliente, type Etapa } from '../dominio/engenharia.ts'
import { avisoDeDuplicata } from '../dominio/duplicata-aviso.ts'
import { publicarNaSala } from '../tempo-real/publicar.ts'
import { comApp, comCliente, comTokenDoApp } from '../auth/middleware.ts'
import { lerTema } from '../dominio/tema.ts'
import { enfileirarAtendimento } from '../agente/fila.ts'
import { veOsChamadosDaEmpresa } from '../auth/token-app.ts'

/**
 * A API do solicitante — o que o widget consome (seção 7).
 *
 * O usuário vê os três grupos da seção 5, não status cru, e vê APENAS os seus
 * chamados; o administrador do tenant vê os da empresa. Nenhuma rota aqui expõe
 * nota interna, rascunho da IA, etapa interna de engenharia além do rótulo, ou
 * dado de outro tenant.
 */
/**
 * **Por que `/api/app/<slug>/…` e não `/api/<slug>/…`.** O middleware desta
 * rota casa em `/api/:app/*`, e com o prefixo curto ele engolia também
 * `/api/console/sessao`: `:app` virava "console", a busca do app falhava e a
 * resposta era 404 antes de a rota interna ser alcançada. Qualquer caminho
 * `/api/<algo>/…` colide com um parâmetro nessa posição.
 *
 * Com os dois espaços separados — `/api/app/<slug>` para o que o app consome,
 * `/api/console` para o que a equipe consome — a fronteira fica visível na URL
 * e nenhum parâmetro pode capturar o outro. Achado pelo aceite da Fase 1.
 */
export const rotasDoSolicitante = new Hono<Ambiente>()

/**
 * CORS para os apps, e só para eles.
 *
 * O widget roda no navegador do cliente, dentro do app, e fala com o Venn Desk
 * — duas origens diferentes. Havia duas saídas:
 *
 *  - **Proxy no app**: cada requisição do widget iria navegador → Worker do app
 *    → Worker do Desk. Mesma origem, sem CORS, e o dobro de latência em tudo —
 *    incluindo o SSE do tempo real, que passaria a atravessar um route handler
 *    do Next. Fluxo longo por dentro de outro Worker é onde isso quebra.
 *  - **CORS**: o navegador fala direto com o Desk. O SSE funciona nativo, a
 *    latência é a real, e o custo é uma lista de origens.
 *
 * Escolhido o segundo. E vale dizer o que o CORS NÃO é: ele não autentica nada
 * — quem autentica é o token assinado pelo app (ADR 0003), e um cliente que
 * não seja navegador ignora CORS por completo. A lista existe para impedir que
 * uma página de terceiro use a sessão do visitante dela, não para proteger a
 * API.
 */
function origensDosApps(env: Ambiente['Bindings']): string[] {
    return (env.ORIGENS_DOS_APPS ?? '')
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o !== '')
}

rotasDoSolicitante.use('/api/app/*', async (c, next) => {
    const origem = c.req.header('Origin')
    const permitida = origem !== undefined && origensDosApps(c.env).includes(origem)

    if (c.req.method === 'OPTIONS') {
        if (!permitida) return c.body(null, 403)
        return c.body(null, 204, {
            'Access-Control-Allow-Origin': origem,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Authorization, Content-Type',
            'Access-Control-Max-Age': '86400',
            Vary: 'Origin',
        })
    }

    await next()

    if (permitida) {
        c.res.headers.set('Access-Control-Allow-Origin', origem)
        /// Sem `Vary: Origin` a borda serviria a um app a resposta cacheada de
        /// outro — e a resposta carrega o cabeçalho que autoriza.
        c.res.headers.append('Vary', 'Origin')
    }
})

rotasDoSolicitante.use('/api/app/:app/*', comCliente, comApp, comTokenDoApp)

const STATUS_DO_GRUPO: Record<GrupoNoWidget, Status[]> = {
    abertos: ['NOVO', 'ABERTO', 'AGUARDANDO_USUARIO'],
    em_andamento: ['EM_ESPERA'],
    fechados: ['RESOLVIDO', 'FECHADO'],
}

const esquemaDaAbertura = z.object({
    assunto: z.string().trim().min(3).max(140),
    descricao: z.string().trim().min(5).max(10_000),
    modulo: z.string().trim().max(80).optional(),
    impacto: z.enum(['so_eu', 'minha_equipe', 'nao_consigo_trabalhar']).default('so_eu'),
    contexto: z.record(z.string(), z.unknown()).optional(),
})

const esquemaDaResposta = z.object({
    corpo: z.string().trim().min(1).max(10_000),
})

function paraOWidget(chamado: {
    numero: number
    assunto: string
    status: string
    tipo: string
    prioridade: string
    criadoEm: Date
    atualizadoEm: Date
}, prefixo: string) {
    return {
        numero: formatarNumero(prefixo, chamado.numero),
        assunto: chamado.assunto,
        grupo: grupoNoWidget(chamado.status as Status),
        status: chamado.status,
        tipo: chamado.tipo,
        prioridade: chamado.prioridade,
        criadoEm: chamado.criadoEm,
        atualizadoEm: chamado.atualizadoEm,
    }
}

rotasDoSolicitante.post('/api/app/:app/chamados', async (c) => {
    const identidade = c.get('identidade')
    const solicitante = c.get('solicitante')

    /**
     * Limite de abertura por usuário e por tenant (seção 5). Vem antes de
     * qualquer leitura do corpo: quem está abusando não deveria custar parse.
     */
    const limite = await c.env.ABERTURA_RATE_LIMITER.limit({
        key: `abertura:${c.get('app').id}:${solicitante.requesterId}`,
    })
    if (!limite.success) {
        throw new ErroDeDominio(
            'limite_de_abertura',
            'Você abriu muitos chamados em pouco tempo. Aguarde um instante.',
            429
        )
    }

    const corpo = esquemaDaAbertura.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('dados_invalidos', 'Preencha assunto e descrição.', 400)
    }

    /**
     * A prioridade é SUGERIDA aqui com a urgência mais conservadora: o widget
     * pergunta o impacto, mas não pergunta se existe contorno — isso quem lê é a
     * triagem, que reclassifica (Fase 4).
     */
    /**
     * O TIPO é sugerido por regra, antes de qualquer modelo.
     *
     * Era fixo em DUVIDA, e isso dava a todo defeito o teto de prioridade de
     * dúvida até a IA reclassificar — em app com atendimento automático
     * desligado, para sempre. A IA reclassifica melhor e continua
     * reclassificando; o palpite de regra é pior que o dela e infinitamente
     * melhor que nenhum, porque é dele que saem a prioridade e o prazo.
     */
    const tipo = tipoSugerido({
        assunto: corpo.data.assunto,
        descricao: corpo.data.descricao,
        contexto: (corpo.data.contexto ?? null) as SinaisDoContexto | null,
    })

    const prioridade = prioridadeSugerida(tipo, corpo.data.impacto as Impacto, 'tem_contorno')

    const chamado = await abrirChamado(c.get('cliente'), c.get('app').id, {
        tenantId: solicitante.tenantId,
        requesterId: solicitante.requesterId,
        assunto: corpo.data.assunto,
        descricao: corpo.data.descricao,
        tipo,
        prioridade,
        origem: 'WIDGET',
        ...(corpo.data.contexto === undefined
            ? {}
            : {
                  contexto: {
                      ...corpo.data.contexto,
                      ...(corpo.data.modulo === undefined ? {} : { modulo: corpo.data.modulo }),
                      plano: identidade.plano ?? null,
                  },
              }),
        ator: `requester:${solicitante.requesterId}`,
    })

    avisarPorEmail(c, 'abertura', {
        id: chamado.id,
        numero: chamado.numero,
        assunto: chamado.assunto,
        requesterId: chamado.requesterId,
        contexto: chamado.contexto,
    })

    /**
     * A suspeita de duplicata vira NOTA INTERNA, em `waitUntil`.
     *
     * Interna porque é palpite nosso sobre o trabalho, não resposta ao cliente;
     * e em `waitUntil` porque é uma consulta a mais que ninguém está esperando
     * para ver o número do chamado.
     */
    c.executionCtx.waitUntil(
        (async () => {
            try {
                const escopoDaTriagem = c.get('escopo')
                const abertos = await escopoDaTriagem.chamados.abertosDoSolicitante(
                    solicitante.requesterId,
                    chamado.id
                )
                const aviso = avisoDeDuplicata(
                    duplicadosProvaveis({ assunto: chamado.assunto }, abertos),
                    c.get('app').prefixo
                )
                if (aviso === null) return

                await escopoDaTriagem.mensagens.adicionar(
                    { ticketId: chamado.id, autor: 'SISTEMA', corpo: aviso, visibilidade: 'INTERNA', origem: 'WIDGET' },
                    { ator: 'sistema' }
                )
            } catch (erro) {
                console.error('[triagem] não consegui checar duplicatas:', erro)
            }
        })()
    )

    /// A thread do chamado no canal do app (seção 8). Como o e-mail: em
    /// `waitUntil`, e falhar não derruba a abertura.
    espelharNoSlack(c, {
        id: chamado.id,
        numero: chamado.numero,
        assunto: chamado.assunto,
        tipo: chamado.tipo,
        prioridade: chamado.prioridade,
        contexto: chamado.contexto,
    })

    /**
     * O atendimento automático entra pela FILA, e em `waitUntil`.
     *
     * Chamar o agente aqui faria o cliente esperar dezenas de segundos para
     * ver "chamado criado" — e o widget pareceria travado justamente quando a
     * pessoa já está irritada com outra coisa. Enfileirar é instantâneo e o
     * `waitUntil` tira até isso do caminho da resposta.
     *
     * A chave é por app e nasce DESLIGADA: nenhum produto começa a gastar
     * sozinho porque alguém publicou um deploy.
     */
    if (c.get('app').atendimentoAutomatico) {
        c.executionCtx.waitUntil(
            enfileirarAtendimento(c.env.ATENDIMENTO, {
                appId: c.get('app').id,
                numero: chamado.numero,
            })
        )
    }

    return c.json({ chamado: paraOWidget(chamado, c.get('app').prefixo) }, 201)
})

rotasDoSolicitante.get('/api/app/:app/chamados', async (c) => {
    const identidade = c.get('identidade')
    const solicitante = c.get('solicitante')
    const app = c.get('app')

    const grupo = c.req.query('grupo')
    const daEmpresa = c.req.query('escopo') === 'empresa'

    if (daEmpresa && !veOsChamadosDaEmpresa(identidade)) {
        throw new ErroDeDominio(
            'sem_permissao',
            'Só o administrador da conta vê os chamados da empresa.',
            403
        )
    }

    const chamados = await c.get('escopo').chamados.listar({
        ...(daEmpresa
            ? { tenantId: solicitante.tenantId }
            : { requesterId: solicitante.requesterId }),
        ...(grupo === 'abertos' || grupo === 'em_andamento' || grupo === 'fechados'
            ? { status: STATUS_DO_GRUPO[grupo] }
            : {}),
    })

    return c.json({ chamados: chamados.map((chamado) => paraOWidget(chamado, app.prefixo)) })
})

/** Carrega o chamado conferindo que ele é de quem pede. */
async function chamadoDoSolicitante(c: Context<Ambiente>) {
    const numero = Number(c.req.param('numero'))
    if (!Number.isInteger(numero) || numero < 1) {
        throw new ErroDeDominio('chamado_nao_encontrado', 'Chamado não encontrado.', 404)
    }

    const chamado = await c.get('escopo').chamados.porNumero(numero)
    const solicitante = c.get('solicitante')

    /**
     * Mesma resposta para "não existe" e "não é seu": dizer qual dos dois
     * confirmaria a existência de chamado de outra pessoa.
     */
    const ehDele = chamado !== null && chamado.requesterId === solicitante.requesterId
    const ehDaEmpresa =
        chamado !== null &&
        chamado.tenantId === solicitante.tenantId &&
        veOsChamadosDaEmpresa(c.get('identidade'))

    if (chamado === null || !(ehDele || ehDaEmpresa)) {
        throw new ErroDeDominio('chamado_nao_encontrado', 'Chamado não encontrado.', 404)
    }

    return chamado
}

rotasDoSolicitante.get('/api/app/:app/chamados/:numero', async (c) => {
    const chamado = await chamadoDoSolicitante(c)
    const escopo = c.get('escopo')

    const mensagens = await escopo.mensagens.publicas(chamado.id)
    const anexos = await escopo.anexos.doChamado(chamado.id)

    /**
     * A nota já dada vem junto, para o widget saber se ainda pergunta.
     *
     * Sem isso ele perguntaria de novo a cada abertura do painel, e insistir
     * com quem já respondeu é o jeito mais rápido de ninguém mais responder.
     * `podeAvaliar` decide se a pergunta cabe; `nota` decide se já coube.
     */
    const avaliacao = await escopo.csat.doChamado(chamado.id)

    /**
     * A etapa de engenharia, em palavras de produto.
     *
     * É o que a Fase 5 promete ao cliente: ele acompanha a correção sem ver
     * issue, PR nem nome de branch. Só quando há defeito vinculado; e a recusa
     * do gestor volta a dizer "em análise", porque é decisão interna sobre COMO
     * resolver (ver `src/dominio/engenharia.ts`).
     */
    const problema = chamado.problemId === null ? null : await escopo.problemas.porId(chamado.problemId)

    /**
     * O chamado foi mesclado? O widget precisa levar a pessoa ao outro.
     *
     * Sem isto ela veria um chamado fechado com uma mensagem citando um número
     * que ela não consegue abrir dali — e a mesclagem, que existe para juntar a
     * conversa, teria dividido a navegação.
     */
    const mescladoEm =
        chamado.mescladoEmId === null ? null : await escopo.chamados.porId(chamado.mescladoEmId)

    return c.json({
        chamado: paraOWidget(chamado, c.get('app').prefixo),
        mescladoEm:
            mescladoEm === null
                ? null
                : { numero: formatarNumero(c.get('app').prefixo, mescladoEm.numero) },
        correcao:
            problema === null
                ? null
                : { etapa: etapaParaOCliente(problema.etapa as Etapa), atualizadoEm: problema.atualizadoEm },
        csat: {
            podeAvaliar:
                podeAvaliar(chamado.status) &&
                chamado.requesterId === c.get('solicitante').requesterId,
            nota: avaliacao?.nota ?? null,
        },
        mensagens: mensagens.map((mensagem) => ({
            id: mensagem.id,
            autor: mensagem.autor,
            corpo: mensagem.corpo,
            criadoEm: mensagem.criadoEm,
        })),
        anexos: anexos.map((anexo) => ({
            id: anexo.chave,
            nome: anexo.nome,
            tipo: anexo.tipo,
            tamanho: anexo.tamanho,
        })),
    })
})

/**
 * A nota de satisfação, dada por quem recebeu o atendimento.
 *
 * **Quem avalia é o solicitante do chamado, não a empresa inteira.** Um
 * administrador que vê os chamados da empresa (`veOsChamadosDaEmpresa`) pode
 * LER o chamado de uma colega, e não deve poder avaliar o atendimento que ela
 * recebeu — a nota é a impressão de quem foi atendido.
 *
 * `atendidoPelaIa` é DEDUZIDO aqui, das mensagens do chamado. Recebê-lo do
 * corpo tornaria editável, por quem responde o formulário, a métrica que decide
 * se o atendimento automático é ligado num app.
 */
rotasDoSolicitante.post('/api/app/:app/chamados/:numero/csat', async (c) => {
    const chamado = await chamadoDoSolicitante(c)
    const escopo = c.get('escopo')
    const solicitante = c.get('solicitante')

    if (chamado.requesterId !== solicitante.requesterId) {
        throw new ErroDeDominio(
            'nao_e_seu',
            'A nota é de quem foi atendido. Este chamado é de outra pessoa.',
            403
        )
    }

    if (!podeAvaliar(chamado.status)) {
        throw new ErroDeDominio(
            'chamado_em_andamento',
            'Este chamado ainda está em andamento. A nota vem quando ele for encerrado.',
            422
        )
    }

    const corpo = esquemaDaNota.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('nota_invalida', `A nota vai de ${NOTA_MINIMA} a ${NOTA_MAXIMA}.`, 400)
    }

    const mensagens = await escopo.mensagens.todas(chamado.id)

    const resposta = await escopo.csat.registrar({
        ticketId: chamado.id,
        nota: corpo.data.nota,
        ...(corpo.data.comentario === undefined ? {} : { comentario: corpo.data.comentario }),
        atendidoPelaIa: atendidoPelaIa(mensagens),
    })

    /// A trilha registra a nota, não o comentário: o texto é do cliente e já
    /// está na linha do CSAT; repeti-lo no evento o espalharia por um lugar a
    /// mais, sem acrescentar o que a trilha precisa saber.
    await escopo.eventos.registrar({
        ticketId: chamado.id,
        ator: `requester:${solicitante.requesterId}`,
        evento: 'csat:avaliou',
        depois: { nota: resposta.nota, atendidoPelaIa: resposta.atendidoPelaIa },
    })

    /**
     * Nota alta num chamado que um humano respondeu é a melhor fonte de artigo
     * que existe, e é agora que ela aparece. A varredura da noite acharia o
     * mesmo chamado; o gancho só adianta, e a chave do rascunho é a mesma, de
     * modo que os dois caminhos não geram dois rascunhos.
     *
     * Falha de fila NÃO derruba a resposta: o cliente acabou de dar nota, e o
     * que ele espera é o recibo.
     */
    if (c.env.SUGESTOES_AUTOMATICAS === 'sim' && resposta.nota >= NOTA_MINIMA_DO_CSAT && !resposta.atendidoPelaIa) {
        try {
            await c.env.CONHECIMENTO?.send({ tipo: 'sugerir-de-chamado', appId: escopo.appId, ticketId: chamado.id })
        } catch (erro) {
            console.error('[sugestoes] não consegui enfileirar o chamado avaliado:', erro)
        }
    }

    return c.json({ nota: resposta.nota, registradaEm: resposta.criadoEm.toISOString() })
})

rotasDoSolicitante.post('/api/app/:app/chamados/:numero/mensagens', async (c) => {
    const chamado = await chamadoDoSolicitante(c)
    const escopo = c.get('escopo')
    const solicitante = c.get('solicitante')

    const corpo = esquemaDaResposta.safeParse(await c.req.json().catch(() => null))
    if (!corpo.success) {
        throw new ErroDeDominio('dados_invalidos', 'Escreva a sua mensagem.', 400)
    }

    /**
     * Chamado fechado é imutável: a resposta do usuário gera chamado de
     * acompanhamento (seção 6). A decisão é aqui, na rota, e não na máquina de
     * estados — que só conhece transições.
     */
    if (chamado.status === 'FECHADO') {
        const novo = await abrirChamado(c.get('cliente'), c.get('app').id, {
            tenantId: solicitante.tenantId,
            requesterId: solicitante.requesterId,
            assunto: `Acompanhamento de ${formatarNumero(c.get('app').prefixo, chamado.numero)}`,
            descricao: corpo.data.corpo,
            origem: 'WIDGET',
            ator: `requester:${solicitante.requesterId}`,
        })

        return c.json({ chamado: paraOWidget(novo, c.get('app').prefixo), acompanhamento: true }, 201)
    }

    const mensagem = await escopo.mensagens.adicionar(
        {
            ticketId: chamado.id,
            autor: 'USUARIO',
            corpo: corpo.data.corpo,
            visibilidade: 'PUBLICA',
            origem: 'WIDGET',
            autorId: solicitante.requesterId,
        },
        { ator: `requester:${solicitante.requesterId}` }
    )

    /// A mensagem do usuário devolve o chamado à fila — e reabre o resolvido.
    const atualizado = await escopo.chamados.aplicarEvento(
        chamado.id,
        'mensagem_do_usuario',
        { ator: `requester:${solicitante.requesterId}` }
    )

    /**
     * O empurrão vai INLINE, não em `waitUntil`, e o e-mail vai em `waitUntil`.
     * A divisão é por natureza: a sala é uma chamada local ao Durable Object,
     * de milissegundos, cujo propósito é imediatismo; o e-mail é externo e
     * lento, e esperar por ele atrasaria a tela à toa.
     *
     * (O `waitUntil` foi suspeito e inocentado: quem segurava o empurrão era a
     * máquina de estados recusando `mensagem_do_usuario` em NOVO.)
     */
    await publicarNaSala(c.env.SALAS, chamado.id, { tipo: 'mensagem', resumo: 'usuario' })

    /**
     * A thread do Slack precisa saber que o cliente escreveu, e é a única
     * novidade que ninguém de lá tem como adivinhar: o Console mostra quando
     * alguém abre, mas quem está no Slack não abre o Console a cada minuto.
     */
    avisarNoSlack(c, chamado, 'o cliente respondeu')

    return c.json(
        {
            mensagem: { id: mensagem.id, criadoEm: mensagem.criadoEm },
            chamado: paraOWidget(atualizado, c.get('app').prefixo),
        },
        201
    )
})

/**
 * O link de download do anexo. Curto, assinado, e servido pelo próprio Worker —
 * o bucket é privado e não existe credencial de S3 em lugar nenhum (ver
 * `src/lib/assinatura.ts`).
 */
rotasDoSolicitante.get('/api/app/:app/chamados/:numero/anexos/:id', async (c) => {
    const chamado = await chamadoDoSolicitante(c)
    const anexo = await c.get('escopo').anexos.porChave(c.req.param('id'))

    if (anexo === null || anexo.ticketId !== chamado.id) {
        throw new ErroDeDominio('anexo_nao_encontrado', 'Anexo não encontrado.', 404)
    }

    const expiraEm = Math.floor(Date.now() / 1000) + VALIDADE_DO_LINK_S
    const token = await assinar(c.env.SEGREDO_LINKS, {
        appId: c.get('app').id,
        chave: anexo.chave,
        expiraEm,
    })

    return c.json({
        nome: anexo.nome,
        tipo: anexo.tipo,
        tamanho: anexo.tamanho,
        url: `/arquivos/${encodeURIComponent(anexo.chave)}?t=${token}`,
        expiraEm,
    })
})

/**
 * Quem sou eu, e o que o selo do widget mostra. É a primeira chamada que o
 * widget faz: confirma que o token vale, devolve o nome para a saudação e os
 * contadores do selo.
 *
 * **Por que polling e não SSE nesta fase.** A especificação lista SSE na
 * Fase 2, com consulta periódica como reserva. Invertemos a ordem de
 * propósito: o empurrão de verdade exige um Durable Object para fanout, e ele
 * já chega na Fase 3 junto com o chat ao vivo. Fazer SSE agora significaria uma
 * conexão aberta por usuário consultando o banco em laço — custo real — e
 * depois jogar fora quando o DO existir. O widget consulta este endpoint a cada
 * 20 s aberto e 60 s fechado, o que para um selo é indistinguível, e na Fase 3
 * SSE e WebSocket passam a dividir o mesmo mecanismo.
 */
rotasDoSolicitante.get('/api/app/:app/eu', async (c) => {
    const identidade = c.get('identidade')
    const solicitante = c.get('solicitante')
    const app = c.get('app')

    const contadores = await c.get('escopo').contadores.doSolicitante(solicitante.requesterId)

    return c.json({
        usuario: {
            nome: identidade.nome,
            email: identidade.email,
            veDaEmpresa: veOsChamadosDaEmpresa(identidade),
        },
        app: { slug: app.slug, nome: app.nome, prefixo: app.prefixo },
        /**
         * O tema vem JUNTO com a identidade, e não numa rota própria.
         *
         * O widget já faz esta chamada antes de desenhar qualquer coisa; uma
         * segunda requisição só para saber a cor faria o botão aparecer e
         * depois mudar de cor na frente da pessoa.
         */
        tema: lerTema(app.tema),
        contadores,
    })
})

/** Tipos que o widget pode enviar. Executável nenhum passa (seção 10). */
const TIPOS_DE_ANEXO = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'video/mp4',
    'video/webm',
    'text/plain',
] as const

const TAMANHO_MAXIMO = 10 * 1024 * 1024

/**
 * Anexo do chamado. Vai direto para o R2, privado, e a chave carrega o app e o
 * chamado — então o escopo vale também no armazenamento, não só no banco.
 *
 * O tipo é conferido pela LISTA, não por negação: recusar `.exe` e aceitar o
 * resto deixaria passar tudo que ninguém pensou em listar. E o `Content-Type`
 * que o navegador manda não é confiável, por isso o nome do arquivo também é
 * verificado contra a extensão esperada.
 */
rotasDoSolicitante.post('/api/app/:app/chamados/:numero/anexos', async (c) => {
    const chamado = await chamadoDoSolicitante(c)
    const app = c.get('app')
    const solicitante = c.get('solicitante')

    const formulario = await c.req.formData().catch(() => null)

    /**
     * O tipo que `FormData.get` declara varia entre `@cloudflare/workers-types`
     * e a lib do DOM, e nenhuma das duas descreve bem o que chega aqui em
     * runtime. Então a conferência é por FORMA — tem nome, tipo, tamanho e
     * `stream()` — e não por `instanceof File`, que não compila sobre a união
     * declarada. Um campo de texto com o mesmo nome cai no `typeof !== object`.
     */
    const entrada: unknown = formulario?.get('arquivo')

    const temForma =
        typeof entrada === 'object' &&
        entrada !== null &&
        'size' in entrada &&
        'type' in entrada &&
        'name' in entrada &&
        'stream' in entrada

    if (!temForma) {
        throw new ErroDeDominio('sem_arquivo', 'Nenhum arquivo foi enviado.', 400)
    }

    const arquivo = entrada as {
        name: string
        type: string
        size: number
        stream: () => ReadableStream
    }

    if (arquivo.size === 0 || arquivo.size > TAMANHO_MAXIMO) {
        throw new ErroDeDominio('tamanho_invalido', 'O arquivo deve ter até 10 MB.', 413)
    }

    if (!(TIPOS_DE_ANEXO as readonly string[]).includes(arquivo.type)) {
        throw new ErroDeDominio(
            'tipo_recusado',
            'Envie imagem, PDF, vídeo curto ou texto.',
            415
        )
    }

    /// A chave começa pelo slug do app: é o que a entrega de arquivo usa para
    /// descobrir de quem é o anexo antes de conferir a assinatura.
    const chave = `${app.slug}/${chamado.id}/${crypto.randomUUID()}`

    await c.env.ANEXOS.put(chave, arquivo.stream(), {
        httpMetadata: { contentType: arquivo.type },
        customMetadata: { appId: app.id, ticketId: chamado.id },
    })

    const anexo = await c.get('escopo').anexos.registrar({
        ticketId: chamado.id,
        chave,
        nome: arquivo.name.slice(0, 200),
        tipo: arquivo.type,
        tamanho: arquivo.size,
    })

    await c.get('escopo').eventos.registrar({
        ticketId: chamado.id,
        ator: `requester:${solicitante.requesterId}`,
        evento: 'anexo',
        depois: { nome: anexo.nome, tipo: anexo.tipo, tamanho: anexo.tamanho },
    })

    return c.json({ anexo: { id: anexo.chave, nome: anexo.nome, tamanho: anexo.tamanho } }, 201)
})

/**
 * O fluxo de eventos do chamado (SSE).
 *
 * A autorização acontece AQUI, com o token do app e a mesma conferência de
 * dono que as outras rotas — `chamadoDoSolicitante`. Só depois a requisição é
 * encaminhada à sala. O Durable Object nunca recebe pedido de fora do Worker e
 * por isso não precisa saber de token.
 */
rotasDoSolicitante.get('/api/app/:app/chamados/:numero/eventos', async (c) => {
    const chamado = await chamadoDoSolicitante(c)

    if (c.env.SALAS === undefined) {
        /// Ambiente sem o binding: o widget cai para a releitura periódica.
        throw new ErroDeDominio('sem_tempo_real', 'Tempo real indisponível.', 501)
    }

    const sala = c.env.SALAS.get(c.env.SALAS.idFromName(chamado.id))
    return sala.fetch('https://sala/assinar')
})
