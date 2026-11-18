import type { McpKey, PrismaClient } from '#prisma'

/**
 * As credenciais do MCP. Como `apps.ts` e `agentes.ts`, não é escopado por app
 * — e aqui pelo motivo mais forte de todos: esta é a consulta que DESCOBRE o
 * app. Quem a chama ainda não sabe de qual app a requisição é; é justamente o
 * que ela responde.
 */

/** `vdk_sup_a1b2c3…` — o prefixo guardado são os 12 primeiros caracteres. */
export const TAMANHO_DO_PREFIXO = 12

export async function chavesPeloPrefixo(
    cliente: PrismaClient,
    prefixo: string
): Promise<McpKey[]> {
    /**
     * Pelo prefixo, e não pela chave inteira: o que está guardado é o hash, e
     * hash não se consulta por igualdade a partir do segredo. O prefixo estreita
     * a busca a uma ou duas linhas, e a conferência é feita uma a uma.
     *
     * `revogadoEm: null` no filtro, e não depois: uma chave revogada não deve
     * nem ser comparada.
     */
    return cliente.mcpKey.findMany({ where: { prefixo, revogadoEm: null } })
}

export async function marcarUso(cliente: PrismaClient, id: string): Promise<void> {
    await cliente.mcpKey.updateMany({ where: { id }, data: { usadoEm: new Date() } })
}

export async function criarChave(
    cliente: PrismaClient,
    dados: {
        appId: string
        nome: string
        escopo: 'SUPORTE' | 'ENGENHARIA'
        hash: string
        prefixo: string
    }
): Promise<McpKey> {
    return cliente.mcpKey.create({ data: dados })
}

export async function chavesDoApp(cliente: PrismaClient, appId: string): Promise<McpKey[]> {
    return cliente.mcpKey.findMany({ where: { appId }, orderBy: { criadoEm: 'desc' } })
}

export async function revogarChave(cliente: PrismaClient, id: string): Promise<boolean> {
    const { count } = await cliente.mcpKey.updateMany({
        where: { id, revogadoEm: null },
        data: { revogadoEm: new Date() },
    })
    return count === 1
}
