/**
 * O cliente da API interna. Uma função só, e ela faz três coisas que a tela não
 * deve repetir: manda o cookie da sessão, transforma erro da API em `Error`
 * com a mensagem que o servidor escreveu, e detecta sessão expirada.
 *
 * Nenhuma URL de `/api/app/...` aparece aqui: aquele espaço é do widget, e o
 * Console não tem token de app nenhum (ver o cabeçalho de
 * `src/rotas/solicitante.ts`).
 */

export class SessaoExpirada extends Error {
    constructor() {
        super('Sessão encerrada. Entre de novo.')
        this.name = 'SessaoExpirada'
    }
}

/**
 * Os códigos que significam "não há sessão" — e só eles.
 *
 * O 401 do Venn Desk tem dois sentidos bem diferentes: a sessão acabou, ou as
 * credenciais estão erradas. Tratar os dois como o primeiro é o defeito que
 * esta lista conserta (ver abaixo).
 */
const SEM_SESSAO = ['sessao_ausente', 'sessao_invalida']

export async function api<T>(
    caminho: string,
    opcoes: { metodo?: string; corpo?: unknown } = {}
): Promise<T> {
    const resposta = await fetch(`/api/console${caminho}`, {
        method: opcoes.metodo ?? 'GET',
        credentials: 'same-origin',
        headers: opcoes.corpo === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(opcoes.corpo === undefined ? {} : { body: JSON.stringify(opcoes.corpo) }),
    })

    const texto = await resposta.text()
    const dados = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>)
    const erro = dados['erro'] as { mensagem?: string; codigo?: string } | undefined

    /**
     * O corpo é lido ANTES de decidir, e o código é que decide.
     *
     * A versão anterior lançava `SessaoExpirada` em qualquer 401, sem abrir o
     * corpo. Na tela de login — onde o único 401 possível é credencial errada —
     * o servidor respondia "E-mail ou senha incorretos." e o Console mostrava
     * "Sessão encerrada. Entre de novo.", mandando a pessoa entrar de novo
     * exatamente com o que acabou de não funcionar. Medido em 18/11/2026, com
     * o André travado na porta.
     */
    if (resposta.status === 401 && SEM_SESSAO.includes(erro?.codigo ?? '')) {
        throw new SessaoExpirada()
    }

    if (!resposta.ok) {
        throw new Error(erro?.mensagem ?? `Falha na requisição (${resposta.status}).`)
    }

    return dados as T
}

export interface Agente {
    nome: string
    papel: 'AGENTE' | 'GESTOR' | 'ADMIN'
}

export interface AppCadastrado {
    slug: string
    nome: string
    prefixo: string
    repositorio: string | null
    canalSuporte: string | null
    canalEngenharia: string | null
    modoSombra: boolean
    atendimentoAutomatico: boolean
    proximoNumero: number
    chaveCadastrada: boolean
}

/**
 * A aparência do widget daquele app. Espelha `src/dominio/tema.ts` no servidor.
 *
 * Os campos opcionais são opcionais de propósito: ausente significa "herde do
 * app", e é diferente de uma cor escolhida que por acaso é a do app.
 */
export interface TemaDoWidget {
    corDeDestaque?: string
    corSobreDestaque?: string
    posicao: 'direita' | 'esquerda'
    margem: number
    atendente: { nome?: string; avatar?: string }
    saudacao?: string
    organizacao?: string
    modulos: string[]
    mostrarBotao: boolean
}

export interface ResumoDeSla {
    estado: 'cumprido' | 'violado' | 'pausado' | 'vencido' | 'em_risco' | 'em_dia'
    meta: 'primeira_resposta' | 'proxima_resposta' | 'resolucao'
    venceEm: string
}

export type Prioridade = 'BAIXA' | 'NORMAL' | 'ALTA' | 'URGENTE'

export interface ChamadoNaFila {
    numero: string
    sequencial: number
    assunto: string
    app: { slug: string; nome: string; prefixo: string }
    /** A unidade que opera — o `Workspace` dos apps. */
    empresa: { id: string; nome: string; plano: string | null }
    /** Quem contrata. Nulo enquanto o app não mandar `account_id`. */
    conta: { id: string; nome: string } | null
    status: string
    tipo: string
    prioridade: Prioridade
    nivel: string
    assigneeId: string | null
    atualizadoEm: string
    /// `null` em chamado aberto antes dos relógios existirem.
    sla: ResumoDeSla | null
}

export interface ChaveDoMcp {
    id: string
    nome: string
    escopo: 'SUPORTE' | 'ENGENHARIA'
    /** Os 12 primeiros caracteres. O resto é hash e não existe em lugar nenhum. */
    prefixo: string
    criadoEm: string
    usadoEm: string | null
    revogadoEm: string | null
}

export interface SegredoEmitido {
    chave: Omit<ChaveDoMcp, 'criadoEm' | 'usadoEm' | 'revogadoEm'>
    /** A ÚNICA vez que este valor existe fora do cofre de quem recebeu. */
    segredo: string
    aviso: string
}

export interface Atendimento {
    fim: 'concluiu' | 'teto'
    chamadas: string[]
    consumo: { passos: number; tokensDeEntrada: number; tokensDeSaida: number }
    /** O que a IA concluiu. NÃO é o que foi dito ao cliente. */
    conclusao: string
}

export interface OpcoesDeFiltro {
    apps: { slug: string; nome: string; prefixo: string }[]
    empresas: { id: string; nome: string; app: string }[]
    contas: { id: string; nome: string; app: string }[]
}

export interface MetaDeSla {
    prioridade: 'URGENTE' | 'ALTA' | 'NORMAL' | 'BAIXA'
    /** Falso quando o app ainda usa o padrão embutido. */
    propria: boolean
    primeiraRespostaMin: number
    proximaRespostaMin: number
    resolucaoMin: number
}

export interface Mensagem {
    id: string
    autor: 'USUARIO' | 'IA' | 'HUMANO' | 'SISTEMA'
    visibilidade: 'PUBLICA' | 'INTERNA'
    origem: string
    corpo: string
    rascunho: boolean
    /** Rascunho recusado. Fica na trilha, mas nunca foi mensagem. */
    descartadoEm: string | null
    criadoEm: string
}

export interface Evento {
    id: string
    ator: string
    evento: string
    criadoEm: string
}

export interface ChamadoCompleto {
    chamado: {
        numero: string
        assunto: string
        status: string
        tipo: string
        prioridade: string
        nivel: string
        contexto: Record<string, unknown> | null
        criadoEm: string
    }
    app: { slug: string; nome: string; prefixo: string }
    empresa: {
        id: string
        nome: string
        plano: string | null
        conta: { id: string; nome: string } | null
    } | null
    sla: ResumoDeSla | null
    mensagens: Mensagem[]
    eventos: Evento[]
    anexos: { chave: string; nome: string; tipo: string; tamanho: number }[]
}
