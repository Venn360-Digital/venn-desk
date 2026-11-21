export type Etapa =
    | 'TRIADO'
    | 'ISSUE_CRIADA'
    | 'APROVADO_PELO_GESTOR'
    | 'EM_CORRECAO'
    | 'PR_ABERTO'
    | 'EM_STAGING'
    | 'APROVADO_PARA_PRODUCAO'
    | 'EM_PRODUCAO'
    | 'VERIFICADO'
    | 'RECUSADO_PELO_GESTOR'

/**
 * A ordem das etapas de engenharia (seção 6).
 *
 * Serve para uma pergunta só, e ela é a razão de este módulo existir: um evento
 * do GitHub pode chegar FORA DE ORDEM. O webhook de "check concluído" de um
 * push antigo chega depois do deploy; uma reentrega do GitHub traz de volta o
 * "PR aberto" de ontem. Sem comparar, a etapa do problema andaria para trás e o
 * cliente veria o chamado regredir de "em staging" para "em correção".
 */
const ORDEM: Etapa[] = [
    'TRIADO',
    'ISSUE_CRIADA',
    'APROVADO_PELO_GESTOR',
    'EM_CORRECAO',
    'PR_ABERTO',
    'EM_STAGING',
    'APROVADO_PARA_PRODUCAO',
    'EM_PRODUCAO',
    'VERIFICADO',
]

/**
 * A etapa nova vale? Só se for ADIANTE da atual.
 *
 * `RECUSADO_PELO_GESTOR` é estado final e não compete na ordem: dele não se sai
 * por evento do GitHub, só por decisão humana registrada.
 */
export function avanca(de: Etapa, para: Etapa): boolean {
    if (de === 'RECUSADO_PELO_GESTOR' || para === 'RECUSADO_PELO_GESTOR') return false
    const i = ORDEM.indexOf(de)
    const j = ORDEM.indexOf(para)
    return i >= 0 && j > i
}

/**
 * O chamado citado num texto do GitHub: nome de branch, título ou corpo.
 *
 * É assim que um evento do GitHub encontra o chamado que o originou, e a
 * convenção é o nome da branch (`desk/ODB-1042`). A alternativa seria guardar o
 * número da issue ao criá-la e procurar por ele — e isso só funciona para a
 * issue, não para o PR, o check e o deploy, que chegam com outros
 * identificadores.
 *
 * Exige o prefixo do app em letras e o número: `ODB-1042`. Um número solto não
 * serve, porque todo evento do GitHub tem números.
 */
export function chamadoNaReferencia(texto: string): { prefixo: string; numero: number } | null {
    const achado = /\b([A-Z]{2,5})-(\d{1,9})\b/.exec(texto.toUpperCase())
    if (achado === null) return null

    const numero = Number(achado[2])
    return Number.isSafeInteger(numero) && numero > 0 ? { prefixo: achado[1] ?? '', numero } : null
}

export interface EventoDoGitHub {
    /** `issues`, `pull_request`, `check_suite`, `deployment_status`. */
    tipo: string
    /** `opened`, `closed`, `completed`, `success`… */
    acao: string
    /** `success` ou `failure`, quando o evento tem resultado. */
    conclusao?: string | undefined
    /** `staging` ou `producao`, quando o evento é de deploy. */
    ambiente?: string | undefined
    /** `true` quando o PR foi mesclado, não apenas fechado. */
    mesclado?: boolean | undefined
}

export type TipoDeLink = 'ISSUE' | 'PR' | 'RUN' | 'DEPLOY'

export interface LeituraDoEvento {
    /** A etapa que o evento alcança, ou `null` quando ele não move nada. */
    etapa: Etapa | null
    /** O que registrar em `eng_links`, ou `null`. */
    link: TipoDeLink | null
    /** Uma linha para a thread e para a trilha. Texto nosso. */
    resumo: string
}

/**
 * Traduz um evento do GitHub em etapa e link.
 *
 * Nem todo evento move a etapa, e isso é de propósito: um check que falhou é
 * informação importante para a thread e NÃO é um passo adiante. Confundir as
 * duas coisas faria o cliente ver "em staging" quando o teste reprovou.
 */
export function lerEvento(e: EventoDoGitHub): LeituraDoEvento {
    if (e.tipo === 'issues') {
        if (e.acao === 'opened') return { etapa: 'ISSUE_CRIADA', link: 'ISSUE', resumo: 'issue criada' }
        if (e.acao === 'closed') return { etapa: null, link: null, resumo: 'issue fechada' }
        return { etapa: null, link: null, resumo: `issue: ${e.acao}` }
    }

    if (e.tipo === 'pull_request') {
        if (e.acao === 'opened' || e.acao === 'reopened') {
            return { etapa: 'PR_ABERTO', link: 'PR', resumo: 'PR aberto' }
        }
        if (e.acao === 'closed') {
            /**
             * Mesclado é passo adiante; fechado sem mesclar é recuo, e recuo não
             * se registra como etapa — a correção foi abandonada, e quem decide
             * o que fazer com o chamado é uma pessoa.
             */
            return e.mesclado === true
                ? { etapa: 'EM_STAGING', link: 'PR', resumo: 'PR mesclado, indo para staging' }
                : { etapa: null, link: null, resumo: 'PR fechado sem mesclar' }
        }
        return { etapa: null, link: null, resumo: `PR: ${e.acao}` }
    }

    if (e.tipo === 'check_suite' || e.tipo === 'check_run' || e.tipo === 'workflow_run') {
        if (e.acao !== 'completed') return { etapa: null, link: null, resumo: 'verificação em andamento' }
        return e.conclusao === 'success'
            ? { etapa: null, link: 'RUN', resumo: 'verificações passaram' }
            : { etapa: null, link: 'RUN', resumo: `verificação falhou (${e.conclusao ?? 'sem conclusão'})` }
    }

    if (e.tipo === 'deployment_status') {
        if (e.conclusao !== 'success') {
            return { etapa: null, link: 'DEPLOY', resumo: `deploy falhou (${e.ambiente ?? 'ambiente não informado'})` }
        }
        /// Produção é a Fase 6 e só acontece depois do portão humano; o webhook
        /// registra o fato, e quem aprova é quem aprova.
        return e.ambiente === 'producao' || e.ambiente === 'production'
            ? { etapa: 'EM_PRODUCAO', link: 'DEPLOY', resumo: 'publicado em produção' }
            : { etapa: 'EM_STAGING', link: 'DEPLOY', resumo: 'publicado em staging' }
    }

    return { etapa: null, link: null, resumo: `evento sem tratamento: ${e.tipo}` }
}

/** O que o cliente lê no widget. Sem jargão de engenharia e sem prazo. */
const PARA_O_CLIENTE: Record<Etapa, string> = {
    TRIADO: 'em análise pela equipe técnica',
    ISSUE_CRIADA: 'registrado para correção',
    APROVADO_PELO_GESTOR: 'correção autorizada',
    EM_CORRECAO: 'em correção',
    PR_ABERTO: 'correção escrita, em revisão',
    EM_STAGING: 'em teste no ambiente de homologação',
    APROVADO_PARA_PRODUCAO: 'aprovada para publicação',
    EM_PRODUCAO: 'publicado',
    VERIFICADO: 'corrigido e verificado',
    RECUSADO_PELO_GESTOR: 'em análise pela equipe técnica',
}

/**
 * A etapa em palavras que o cliente entende.
 *
 * `RECUSADO_PELO_GESTOR` volta a dizer "em análise": recusa é decisão interna
 * sobre COMO resolver, e contá-la ao cliente seria expor uma discussão nossa
 * sem lhe dar nada em troca. O chamado volta para uma pessoa, que responde.
 */
export function etapaParaOCliente(etapa: Etapa): string {
    return PARA_O_CLIENTE[etapa]
}
