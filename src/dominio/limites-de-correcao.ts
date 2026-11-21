/**
 * As regras de limite de uma correção automática (Fase 5).
 *
 * Elas não decidem se a correção é boa: decidem se uma PESSOA precisa olhar
 * antes. É a diferença entre um sistema que corrige defeito pequeno sozinho e
 * um que troca o esquema do banco de madrugada porque um chamado pediu.
 *
 * Nada aqui bloqueia por si: o resultado vira o aviso do pedido de aprovação e
 * a nota na thread. Quem aprova continua sendo quem aprova — a regra só garante
 * que ele saiba o que está aprovando.
 */

/** Acima disto, ninguém revisa de verdade: aprova no susto ou não aprova. */
export const LINHAS_SEM_REVISAO = 400
export const ARQUIVOS_SEM_REVISAO = 20

/**
 * Caminhos em que um erro não se percebe testando a tela.
 *
 * Migração muda dado e não volta atrás; autenticação e middleware erram em
 * silêncio e abrem porta; `wrangler` e `package.json` mudam o que roda em
 * produção; `CODEOWNERS` e configuração de CI mudam QUEM precisa aprovar, o que
 * é o caminho mais curto para desmontar a trava.
 */
const SENSIVEIS: { padrao: RegExp; porque: string }[] = [
    { padrao: /(^|\/)prisma\/migrations\//, porque: 'migração de banco' },
    { padrao: /\.sql$/, porque: 'SQL' },
    { padrao: /(^|\/)(auth|autenticacao)\//, porque: 'autenticação' },
    { padrao: /middleware/i, porque: 'middleware' },
    { padrao: /(^|\/)wrangler\.(jsonc?|toml)$/, porque: 'configuração do Worker' },
    { padrao: /(^|\/)package(-lock)?\.json$/, porque: 'dependências' },
    { padrao: /(^|\/)pnpm-lock\.yaml$/, porque: 'dependências' },
    { padrao: /CODEOWNERS/, porque: 'quem aprova' },
    { padrao: /(^|\/)\.github\//, porque: 'configuração de CI' },
]

export interface ArquivoMudado {
    caminho: string
    adicoes?: number
    remocoes?: number
}

export interface Mudanca {
    /** Vem do webhook do PR; é o que existe sem pedir a lista de arquivos. */
    linhas?: number | undefined
    arquivos?: number | undefined
    /** A lista, quando temos permissão para pedi-la. */
    lista?: ArquivoMudado[] | undefined
}

export interface Veredito {
    /** `true` quando uma pessoa precisa ler o diff antes de aprovar. */
    exigeRevisaoHumana: boolean
    /** Os motivos, em palavras de quem vai ler. Vazio quando não exige. */
    motivos: string[]
}

export function avaliarMudanca(m: Mudanca): Veredito {
    const motivos: string[] = []

    if (m.linhas !== undefined && m.linhas > LINHAS_SEM_REVISAO) {
        motivos.push(`${m.linhas} linhas alteradas (acima de ${LINHAS_SEM_REVISAO})`)
    }
    if (m.arquivos !== undefined && m.arquivos > ARQUIVOS_SEM_REVISAO) {
        motivos.push(`${m.arquivos} arquivos mexidos (acima de ${ARQUIVOS_SEM_REVISAO})`)
    }

    /// Um motivo por RAZÃO, não por arquivo: cinco migrações numa correção são
    /// o mesmo alerta, e repeti-lo cinco vezes esconde os outros.
    const razoes = new Set<string>()
    for (const arquivo of m.lista ?? []) {
        /**
         * O PRIMEIRO padrão que casar, e a lista está ordenada do mais
         * específico ao mais geral. `prisma/migrations/x/migration.sql` casa
         * "migração de banco" e também ".sql"; dizer as duas coisas do mesmo
         * arquivo gasta a atenção de quem lê com uma informação só.
         */
        const razao = SENSIVEIS.find((s) => s.padrao.test(arquivo.caminho))
        if (razao !== undefined) razoes.add(razao.porque)
    }
    for (const razao of [...razoes].sort()) motivos.push(`toca ${razao}`)

    /**
     * Sem informação nenhuma, exige revisão.
     *
     * É o caso de um PR cujo tamanho não veio no evento: "não sei o que mudou"
     * tem de levar ao mesmo lugar que "mudou muito", nunca a "pode seguir".
     */
    if (m.linhas === undefined && m.arquivos === undefined && m.lista === undefined) {
        motivos.push('não foi possível medir o tamanho da mudança')
    }

    return { exigeRevisaoHumana: motivos.length > 0, motivos }
}

/** Uma linha para a mensagem de aprovação, ou `null` quando não há o que dizer. */
export function avisoDeLimite(v: Veredito): string | null {
    return v.exigeRevisaoHumana ? `Leia o diff antes de aprovar: ${v.motivos.join('; ')}.` : null
}
