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

    if (resposta.status === 401) throw new SessaoExpirada()

    const texto = await resposta.text()
    const dados = texto === '' ? {} : (JSON.parse(texto) as Record<string, unknown>)

    if (!resposta.ok) {
        const erro = dados['erro'] as { mensagem?: string; codigo?: string } | undefined
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

export interface ChamadoNaFila {
    numero: string
    assunto: string
    status: string
    tipo: string
    prioridade: string
    nivel: string
    assigneeId: string | null
    atualizadoEm: string
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
