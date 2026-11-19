import type { Agent, PrismaClient } from '#prisma'

/**
 * A equipe interna. Como `apps.ts`, não é escopado por app — e aqui por outro
 * motivo: a mesma pessoa atende vários apps, então `agents` não tem `app_id`.
 *
 * Mora em `src/dados/` para a regra do `scripts/lint-isolamento.mjs` continuar
 * valendo sem exceção: nenhum arquivo fora desta pasta toca uma tabela.
 */
export async function agentePorEmail(
    cliente: PrismaClient,
    email: string
): Promise<Agent | null> {
    return cliente.agent.findFirst({ where: { email, ativo: true } })
}

export async function agentePorSlackId(
    cliente: PrismaClient,
    slackId: string
): Promise<Agent | null> {
    return cliente.agent.findFirst({ where: { slackId, ativo: true } })
}

/**
 * Quem recebe alerta de indisponibilidade (seção 7, "alerta os responsáveis").
 *
 * Gestor e admin, humanos e ativos. Agente de nível 1 não entra: ele atende
 * chamado, não decide sobre pane. E a IA não entra por construção — ela não lê
 * e-mail, age pelo MCP.
 */
export async function responsaveisPorAlerta(cliente: PrismaClient): Promise<Agent[]> {
    return cliente.agent.findMany({
        where: { ativo: true, tipo: 'HUMANO', papel: { in: ['GESTOR', 'ADMIN'] } },
        orderBy: { nome: 'asc' },
    })
}

/**
 * Os nomes de vários agentes, numa consulta.
 *
 * Serve à trilha de auditoria, que precisa trocar `agent:<id>` por gente. Em
 * lote porque um chamado com trinta eventos do mesmo agente faria trinta
 * consultas idênticas — e a tela do chamado é a mais aberta do Console.
 *
 * Traz INATIVO também: agente desativado continua tendo feito o que fez, e
 * escondê-lo da leitura apaga o rastro de quem agiu.
 */
export async function nomesDeAgentes(
    cliente: PrismaClient,
    ids: string[]
): Promise<{ id: string; nome: string }[]> {
    if (ids.length === 0) return []

    return cliente.agent.findMany({
        where: { id: { in: ids } },
        select: { id: true, nome: true },
    })
}
