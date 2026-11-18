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
    proximoNumero: number
    chaveCadastrada: boolean
}

export interface ResumoDeSla {
    estado: 'cumprido' | 'violado' | 'pausado' | 'vencido' | 'em_risco' | 'em_dia'
    meta: 'primeira_resposta' | 'proxima_resposta' | 'resolucao'
    venceEm: string
}

export interface ChamadoNaFila {
    numero: string
    assunto: string
    status: string
    tipo: string
    prioridade: string
    nivel: string
    assigneeId: string | null
    atualizadoEm: string
    /// `null` em chamado aberto antes dos relógios existirem.
    sla: ResumoDeSla | null
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
    mensagens: Mensagem[]
    eventos: Evento[]
    anexos: { chave: string; nome: string; tipo: string; tamanho: number }[]
}
