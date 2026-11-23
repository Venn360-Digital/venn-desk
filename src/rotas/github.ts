import { Hono } from 'hono'

import { appPorRepositorio } from '../dados/apps.ts'
import { escopoDoApp } from '../dados/escopo.ts'
import { registrarEntrada } from '../dados/entradas.ts'
import { chamadoNaReferencia, lerEvento } from '../dominio/engenharia.ts'
import type { Ambiente } from '../lib/ambiente.ts'
import { comCliente } from '../auth/middleware.ts'
import { conferirAssinaturaDoGitHub } from '../github/assinatura.ts'
import { avisarNaThread } from '../slack/ponte.ts'
import { resumoDaFumaca, rodarFumaca, sondaDeFumacaHttp } from '../fumaca/rodar.ts'

/**
 * Os webhooks do GitHub (Fase 5).
 *
 * O que entra aqui: issue, PR, verificações e deploy do repositório de um app.
 * O que sai: a etapa do defeito avança, o link vai para `eng_links` e a thread
 * do chamado recebe uma linha.
 *
 * **Como um evento acha o chamado.** Pela referência no nome da branch, no
 * título ou no corpo (`desk/ODB-1042`). A alternativa seria guardar o número da
 * issue ao criá-la, e isso só funcionaria para a issue — o PR, o check e o
 * deploy chegam com outros identificadores.
 *
 * **Nada aqui responde ao cliente.** O evento move a etapa, que o widget
 * mostra em palavras de produto, e escreve nota interna. Mensagem ao cliente
 * continua saindo de pessoa ou de ferramenta.
 */
export const rotasDoGitHub = new Hono<Ambiente>()

const OK = { ok: true }

rotasDoGitHub.post('/github/webhook', comCliente, async (c) => {
    const corpoCru = await c.req.text()

    const veredito = await conferirAssinaturaDoGitHub({
        segredo: c.env.GITHUB_WEBHOOK_SEGREDO,
        assinatura: c.req.header('X-Hub-Signature-256') ?? null,
        corpoCru,
    })
    if (!veredito.ok) {
        /// O motivo vai para o log, nunca para a resposta: dizer a quem bateu
        /// se faltou cabeçalho ou se a assinatura não casou o ajuda a acertar.
        console.warn('[github] webhook recusado:', veredito.motivo)
        return c.json({ erro: 'não autorizado' }, 401)
    }

    const entrega = c.req.header('X-GitHub-Delivery') ?? ''
    if (entrega === '') {
        console.warn('[github] webhook sem X-GitHub-Delivery, ignorado')
        return c.json(OK)
    }

    /**
     * Idempotência por entrega. O GitHub reentrega quando não recebe 2xx em
     * dez segundos, e o deploy de uma correção chega a demorar isso — sem a
     * trava, a etapa avançaria duas vezes e a thread teria a linha dobrada.
     */
    const inedito = await registrarEntrada(c.get('cliente'), 'github', entrega)
    if (!inedito) return c.json(OK)

    let corpo: Record<string, unknown>
    try {
        corpo = JSON.parse(corpoCru) as Record<string, unknown>
    } catch {
        return c.json({ erro: 'corpo inválido' }, 400)
    }

    const repositorio = ((corpo['repository'] ?? {}) as { full_name?: unknown }).full_name
    if (typeof repositorio !== 'string') return c.json(OK)

    const tipo = c.req.header('X-GitHub-Event') ?? ''
    const leitura = lerEvento({
        tipo,
        acao: typeof corpo['action'] === 'string' ? corpo['action'] : '',
        ...extrairResultado(tipo, corpo),
    })

    /**
     * Um repositório, três apps.
     *
     * O `venn-saas` é monorepo, então o mesmo webhook serve aos três produtos —
     * e é a referência (`ODB-1042`) que diz de qual deles o chamado é. Procurar
     * o app pelo repositório e ficar no primeiro daria o chamado ao app errado
     * dois terços das vezes.
     */
    const referencia = chamadoNaReferencia(textoDeReferencia(corpo))
    if (referencia === null) {
        console.log('[github] evento sem chamado referenciado:', JSON.stringify({ tipo, repositorio }))
        return c.json(OK)
    }

    const apps = await appPorRepositorio(c.get('cliente'), repositorio)
    const app = apps.find((a) => a.prefixo.toUpperCase() === referencia.prefixo)
    if (app === undefined) {
        console.log('[github] prefixo sem app:', JSON.stringify({ prefixo: referencia.prefixo, repositorio }))
        return c.json(OK)
    }

    const escopo = escopoDoApp(c.get('cliente'), app.id)
    const chamado = await escopo.chamados.porNumero(referencia.numero)
    if (chamado === null) {
        console.log('[github] chamado referenciado não existe:', JSON.stringify(referencia))
        return c.json(OK)
    }

    /**
     * Sem defeito vinculado, o evento cria um.
     *
     * `eng_links` pende de um defeito, e é ele que carrega a etapa que o
     * cliente vê. Um PR que referencia o chamado É a confirmação de que existe
     * defeito — antes dele havia só suspeita. O título sai do assunto do
     * chamado, e quem quiser um melhor edita no Console.
     */
    let problemId = chamado.problemId
    if (problemId === null) {
        const problema = await escopo.problemas.abrir({ titulo: chamado.assunto })
        await escopo.chamados.vincularProblema(chamado.id, problema.id, { ator: 'sistema:github' })
        problemId = problema.id
    }

    const url = urlDoEvento(corpo)
    if (leitura.link !== null && url !== null) {
        await escopo.linksDeEngenharia.registrar({
            problemId,
            tipo: leitura.link,
            url,
            estado: leitura.resumo,
            ...(typeof corpo['deployment'] === 'object' && corpo['deployment'] !== null
                ? { ambiente: String((corpo['deployment'] as { environment?: unknown }).environment ?? '') }
                : {}),
        })
    }

    const movimento = leitura.etapa === null ? null : await escopo.problemas.avancarEtapa(problemId, leitura.etapa)

    await escopo.eventos.registrar({
        ticketId: chamado.id,
        ator: 'sistema:github',
        evento: 'engenharia:evento',
        depois: {
            tipo,
            resumo: leitura.resumo,
            ...(url === null ? {} : { url }),
            ...(movimento === null ? {} : { de: movimento.de, para: movimento.para }),
        },
    })

    /**
     * Deploy de staging bem-sucedido: o Desk roda os testes de fumaça.
     *
     * De FORA, pela rede, e é essa a diferença que importa. Um teste dentro do
     * pipeline que publicou prova que o build terminou; este prova que o
     * ambiente responde — e é o segundo que vale para quem vai dizer ao cliente
     * que a correção está em homologação.
     *
     * A URL vem do cadastro do app (`urlApp`), não do evento: aceitar a URL que
     * o webhook manda seria sondar o endereço que alguém escolheu.
     */
    let fumaca: string | null = null

    /**
     * Deploy de PRODUÇÃO com fumaça passando: a etapa vira VERIFICADO.
     *
     * É o fim do caminho da Fase 6, e ele é automático de propósito — a
     * verificação é objetiva (as portas respondem depois de publicar), e
     * esperar alguém clicar em "verificado" deixaria todo defeito corrigido
     * parado numa etapa anterior para sempre.
     *
     * O que NÃO é automático: avisar os clientes e resolver os chamados. Isso
     * continua sendo um clique, porque o texto que vai a dezenas de pessoas
     * precisa ser escrito por uma.
     */
    if (movimento?.para === 'EM_PRODUCAO' && app.urlApp !== null && app.urlApp !== '') {
        const resultado = await rodarFumaca({ urlBase: app.urlApp, sonda: sondaDeFumacaHttp })
        fumaca = resumoDaFumaca(resultado)

        await escopo.eventos.registrar({
            ticketId: chamado.id,
            ator: 'sistema:fumaca',
            evento: 'engenharia:fumaca',
            depois: { ambiente: 'producao', passou: resultado.passou, linhas: resultado.linhas },
        })

        if (resultado.passou) {
            const verificou = await escopo.problemas.avancarEtapa(problemId, 'VERIFICADO')
            if (verificou !== null) fumaca = `${fumaca} · defeito verificado`
        }
    }

    if (movimento?.para === 'EM_STAGING' && app.urlApp !== null && app.urlApp !== '') {
        const resultado = await rodarFumaca({ urlBase: app.urlApp, sonda: sondaDeFumacaHttp })
        fumaca = resumoDaFumaca(resultado)

        await escopo.eventos.registrar({
            ticketId: chamado.id,
            ator: 'sistema:fumaca',
            evento: 'engenharia:fumaca',
            depois: { passou: resultado.passou, linhas: resultado.linhas },
        })

        /**
         * Fumaça reprovada NÃO desfaz a etapa.
         *
         * A correção está em staging — isso é fato, e desfazê-lo faria a etapa
         * mentir. O que a falha muda é quem precisa olhar: a linha vai para a
         * thread e para a trilha, e o portão de produção é humano de qualquer
         * forma.
         */
        if (!resultado.passou) {
            await escopo.mensagens.adicionar(
                {
                    ticketId: chamado.id,
                    autor: 'SISTEMA',
                    corpo: `Testes de fumaça depois do deploy de staging:\n${resultado.linhas.join('\n')}`,
                    visibilidade: 'INTERNA',
                    origem: 'MCP',
                },
                { ator: 'sistema:fumaca' }
            )
        }
    }

    /// A thread só recebe o que muda algo: um evento que não move etapa nem
    /// registra link já está na trilha, e repeti-lo no Slack faria a thread
    /// virar log de CI.
    if (movimento !== null || leitura.link !== null) {
        await avisarNaThread({
            escopo,
            config: { token: c.env.SLACK_BOT_TOKEN },
            chamadoId: chamado.id,
            numero: `${app.prefixo}-${chamado.numero}`,
            novidade: fumaca === null ? leitura.resumo : `${leitura.resumo} · ${fumaca}`,
        })
    }

    console.log(
        '[github] evento aplicado:',
        JSON.stringify({ app: app.slug, chamado: referencia.numero, resumo: leitura.resumo, etapa: movimento?.para })
    )
    return c.json(OK)
})

/** O resultado do evento, que vem em campo diferente em cada tipo. */
function extrairResultado(tipo: string, corpo: Record<string, unknown>): { conclusao?: string; ambiente?: string; mesclado?: boolean } {
    if (tipo === 'pull_request') {
        const pr = (corpo['pull_request'] ?? {}) as { merged?: unknown }
        return { mesclado: pr.merged === true }
    }

    if (tipo === 'check_suite' || tipo === 'check_run' || tipo === 'workflow_run') {
        const alvo = (corpo['check_suite'] ?? corpo['check_run'] ?? corpo['workflow_run'] ?? {}) as {
            conclusion?: unknown
        }
        return typeof alvo.conclusion === 'string' ? { conclusao: alvo.conclusion } : {}
    }

    if (tipo === 'deployment_status') {
        const estado = (corpo['deployment_status'] ?? {}) as { state?: unknown }
        const deploy = (corpo['deployment'] ?? {}) as { environment?: unknown }
        return {
            ...(typeof estado.state === 'string' ? { conclusao: estado.state } : {}),
            ...(typeof deploy.environment === 'string' ? { ambiente: deploy.environment } : {}),
        }
    }

    return {}
}

/**
 * Onde procurar a referência ao chamado.
 *
 * Branch primeiro, porque é a convenção (`desk/ODB-1042`) e a única que
 * acompanha o PR, o check e o deploy. Título e corpo entram depois, para o caso
 * de a issue ter sido aberta à mão.
 */
function textoDeReferencia(corpo: Record<string, unknown>): string {
    const pr = (corpo['pull_request'] ?? {}) as { head?: { ref?: unknown }; title?: unknown; body?: unknown }
    const issue = (corpo['issue'] ?? {}) as { title?: unknown; body?: unknown }
    const suite = (corpo['check_suite'] ?? corpo['workflow_run'] ?? {}) as { head_branch?: unknown }
    const deploy = (corpo['deployment'] ?? {}) as { ref?: unknown }

    return [
        typeof pr.head?.ref === 'string' ? pr.head.ref : '',
        typeof suite.head_branch === 'string' ? suite.head_branch : '',
        typeof deploy.ref === 'string' ? deploy.ref : '',
        typeof pr.title === 'string' ? pr.title : '',
        typeof issue.title === 'string' ? issue.title : '',
        typeof pr.body === 'string' ? pr.body : '',
        typeof issue.body === 'string' ? issue.body : '',
    ]
        .filter((t) => t !== '')
        .join('\n')
}

function urlDoEvento(corpo: Record<string, unknown>): string | null {
    for (const chave of ['pull_request', 'issue', 'check_suite', 'check_run', 'workflow_run', 'deployment_status']) {
        const alvo = corpo[chave] as { html_url?: unknown; target_url?: unknown } | undefined
        const url = alvo?.html_url ?? alvo?.target_url
        if (typeof url === 'string' && url.startsWith('https://')) return url
    }
    return null
}
