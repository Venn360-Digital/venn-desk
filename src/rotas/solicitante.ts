import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { abrirChamado } from '../dados/abertura.ts'
import { formatarNumero } from '../dominio/numero.ts'
import { grupoNoWidget, type GrupoNoWidget, type Status } from '../dominio/estados.ts'
import { prioridadeSugerida, type Impacto } from '../dominio/prioridade.ts'
import { assinar, VALIDADE_DO_LINK_S } from '../lib/assinatura.ts'
import { ErroDeDominio } from '../lib/erros.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { avisarPorEmail } from '../correio/avisar.ts'
import { comApp, comCliente, comTokenDoApp } from '../auth/middleware.ts'
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
    const prioridade = prioridadeSugerida(
        'DUVIDA',
        corpo.data.impacto as Impacto,
        'tem_contorno'
    )

    const chamado = await abrirChamado(c.get('cliente'), c.get('app').id, {
        tenantId: solicitante.tenantId,
        requesterId: solicitante.requesterId,
        assunto: corpo.data.assunto,
        descricao: corpo.data.descricao,
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

    return c.json({
        chamado: paraOWidget(chamado, c.get('app').prefixo),
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
