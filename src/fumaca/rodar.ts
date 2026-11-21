/**
 * Os testes de fumaça que o Venn Desk roda depois do deploy de staging
 * (Fase 5).
 *
 * **Por que o Desk e não o CI do app.** Um teste que roda dentro do mesmo
 * pipeline que publicou prova que o build terminou. Este, feito de fora, pela
 * rede, prova que o ambiente RESPONDE — o que é outra coisa, e é a que importa
 * para quem vai dizer ao cliente que a correção está em homologação.
 *
 * **Fumaça é fumaça.** Nenhuma destas verificações faz login, cria registro ou
 * toca dado de ninguém: elas perguntam se as portas abrem. A navegação com dado
 * fictício é a etapa 7 do plano da base viva, e exige o tenant de laboratório.
 */

/**
 * A sonda da fumaça devolve o STATUS, não um veredito.
 *
 * A da saúde (`src/saude/verificar.ts`) resolve "o app está de pé?" e por isso
 * entrega `ok`. Aqui o 401 de uma API protegida é SUCESSO, e um `ok: false`
 * perderia essa diferença — a verificação que mais importa é justamente a que
 * espera uma recusa.
 */
export interface SondagemDeFumaca {
    status: number | null
    /** Status HTTP ou nome do erro. NUNCA corpo da resposta. */
    erro?: string | undefined
}

export type SondaDeFumaca = (url: string) => Promise<SondagemDeFumaca>

export const sondaDeFumacaHttp: SondaDeFumaca = async (url) => {
    try {
        const resposta = await fetch(url, {
            method: 'GET',
            /// `cacheTtl: 0` e `redirect: manual`, como na saúde: um 200 do
            /// cache da borda não prova que o ambiente novo responde, e seguir
            /// redirecionamento esconderia justamente o 302 que queremos ver.
            cf: { cacheTtl: 0 },
            redirect: 'manual',
            headers: { 'User-Agent': 'VennDesk-Fumaca/1.0', 'Cache-Control': 'no-cache' },
        })
        return { status: resposta.status }
    } catch (erro) {
        return { status: null, erro: erro instanceof Error ? erro.name : 'erro' }
    }
}

export interface Verificacao {
    nome: string
    caminho: string
    /** O que conta como passar. A home pode redirecionar para o login. */
    aceita: number[]
}

/**
 * As quatro portas que todo app tem.
 *
 * Poucas e genéricas de propósito: elas valem para os três produtos sem
 * cadastro nenhum, e uma lista por app envelheceria sem ninguém notar — o pior
 * tipo de teste é o que passa porque deixou de olhar.
 */
export const VERIFICACOES: Verificacao[] = [
    /// Raiz: 200 ou o redirecionamento para o login. Um 500 aqui é o deploy
    /// quebrado, e é o caso que este teste existe para pegar.
    { nome: 'raiz responde', caminho: '/', aceita: [200, 301, 302, 303, 307, 308] },
    { nome: 'login abre', caminho: '/entrar', aceita: [200, 301, 302, 307, 308] },
    /**
     * A API precisa RECUSAR sem credencial. Um 200 aqui seria pior que um 500:
     * significaria endpoint aberto, e o teste de fumaça é o único lugar em que
     * isso apareceria antes de um cliente achar.
     */
    { nome: 'API recusa sem credencial', caminho: '/api/me', aceita: [401, 403, 404] },
    { nome: 'arquivo estático serve', caminho: '/favicon.ico', aceita: [200, 204, 301, 302, 304, 404] },
]

export interface ResultadoDaFumaca {
    passou: boolean
    /** Uma linha por verificação, para a thread. */
    linhas: string[]
    total: number
    falharam: number
}

export async function rodarFumaca(p: {
    /** A base do ambiente recém-publicado, sem barra no fim. */
    urlBase: string
    sonda: SondaDeFumaca
    verificacoes?: Verificacao[]
}): Promise<ResultadoDaFumaca> {
    const verificacoes = p.verificacoes ?? VERIFICACOES
    const base = p.urlBase.replace(/\/+$/, '')

    /// Em paralelo, e uma verificação não derruba as outras: saber que três
    /// portas abriram e uma não é mais útil que um erro só.
    const resultados = await Promise.all(
        verificacoes.map(async (v) => {
            try {
                const sondagem = await p.sonda(`${base}${v.caminho}`)
                const ok = sondagem.status !== null && v.aceita.includes(sondagem.status)
                return { v, ok, detalhe: sondagem.status === null ? (sondagem.erro ?? 'sem resposta') : String(sondagem.status) }
            } catch (erro) {
                return { v, ok: false, detalhe: erro instanceof Error ? erro.message.slice(0, 80) : 'erro' }
            }
        })
    )

    const linhas = resultados.map((r) => `${r.ok ? '✓' : '✗'} ${r.v.nome} (${r.detalhe})`)
    const falharam = resultados.filter((r) => !r.ok).length

    return { passou: falharam === 0, linhas, total: resultados.length, falharam }
}

/** Uma linha para a thread do chamado. O detalhe fica na trilha. */
export function resumoDaFumaca(r: ResultadoDaFumaca): string {
    return r.passou
        ? `testes de fumaça passaram (${r.total} verificações)`
        : `testes de fumaça: ${r.falharam} de ${r.total} falharam`
}
