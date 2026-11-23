import type { Conexao } from '../escopo.ts'

/**
 * A conexão falsa existe para provar o ISOLAMENTO sem banco — o Miniflare não
 * roda nesta máquina e um Postgres local não existe aqui.
 *
 * Ela registra todo argumento que a camada de escopo passa ao Prisma, e **lança
 * em `findUnique` e em `update`**. Essas duas são exatamente as formas que não
 * conseguem carregar o `appId` ao lado do `id`: se alguém as usar no escopo um
 * dia, a prova quebra aqui, e não em produção com dado de outro cliente na tela.
 *
 * Mora em `src/dados/testes/` e não ao lado do teste do escopo porque o
 * sincronizador da base e a fila do conhecimento precisam da mesma prova — e
 * duas conexões falsas divergiriam no dia em que uma ganhasse um delegado.
 *
 * `$queryRaw` e `$executeRaw` são registrados como `sql.queryRaw` e
 * `sql.executeRaw`: a busca por vetor é SQL cru, e o teste precisa ver o
 * `appId` também ali.
 */

export interface Chamada {
    delegado: string
    metodo: string
    args: Record<string, unknown>
}

export function conexaoFalsa(respostas: Record<string, unknown> = {}) {
    const chamadas: Chamada[] = []

    const delegado = (nome: string) =>
        new Proxy(
            {},
            {
                get(_alvo, metodo: string) {
                    if (metodo === 'findUnique' || metodo === 'update') {
                        return () => {
                            throw new Error(
                                `${nome}.${metodo} não pode ser usado no escopo: não aceita appId ao lado do id`
                            )
                        }
                    }

                    return (args: Record<string, unknown>) => {
                        chamadas.push({ delegado: nome, metodo, args })
                        const resposta = respostas[`${nome}.${metodo}`]
                        if (typeof resposta === 'function') {
                            return Promise.resolve((resposta as (a: unknown) => unknown)(args))
                        }
                        if (metodo === 'findMany') return Promise.resolve(resposta ?? [])
                        if (metodo === 'updateMany') return Promise.resolve(resposta ?? { count: 1 })
                        if (metodo === 'create' || metodo === 'upsert') {
                            return Promise.resolve(resposta ?? { id: `${nome}-novo` })
                        }
                        return Promise.resolve(resposta ?? null)
                    }
                },
            }
        )

    /// SQL cru: o template literal chega como `strings` + valores. Registra os
    /// dois para o teste conferir que o `appId` está entre os parâmetros.
    const cru =
        (metodo: 'queryRaw' | 'executeRaw') =>
        (strings: TemplateStringsArray, ...valores: unknown[]) => {
            chamadas.push({ delegado: 'sql', metodo, args: { sql: strings.join('?'), valores } })
            const resposta = respostas[`sql.${metodo}`]
            if (typeof resposta === 'function') {
                return Promise.resolve((resposta as (v: unknown[]) => unknown)(valores))
            }
            return Promise.resolve(resposta ?? (metodo === 'queryRaw' ? [] : 0))
        }

    const conexao = {
        app: delegado('app'),
        ticket: delegado('ticket'),
        ticketMessage: delegado('ticketMessage'),
        ticketEvent: delegado('ticketEvent'),
        attachment: delegado('attachment'),
        tenant: delegado('tenant'),
        requester: delegado('requester'),
        slaTimer: delegado('slaTimer'),
        slaPolicy: delegado('slaPolicy'),
        kbArticle: delegado('kbArticle'),
        kbConsulta: delegado('kbConsulta'),
        kbSincronizacao: delegado('kbSincronizacao'),
        kbEvento: delegado('kbEvento'),
        csatResponse: delegado('csatResponse'),
        slackThread: delegado('slackThread'),
        problem: delegado('problem'),
        engLink: delegado('engLink'),
        approval: delegado('approval'),
        macro: delegado('macro'),
        visaoSalva: delegado('visaoSalva'),
        tag: delegado('tag'),
        ticketTag: delegado('ticketTag'),
        $queryRaw: cru('queryRaw'),
        $executeRaw: cru('executeRaw'),
    } as unknown as Conexao

    return { conexao, chamadas }
}
