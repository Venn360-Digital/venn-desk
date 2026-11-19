/**
 * Quem fez — em nome de gente, não em identificador.
 *
 * A trilha grava o ator como `tipo:id` (`agent:cmwj7x2…`, `requester:cmw…`,
 * `ia:agente`), e isso é certo no banco: o id não muda quando a pessoa troca de
 * nome, e é ele que liga o evento a quem o praticou. Errado é mostrar na tela.
 *
 * O Console exibia a string crua, e a consequência não é estética: a trilha de
 * auditoria existe para alguém reconstruir o que houve num chamado, e uma
 * coluna de `cmwj7x2a90001…` obriga a decorar id para ler a própria história.
 * Quem recorre à trilha está, por definição, com pressa.
 */

export type TipoDeAtor = 'agente' | 'solicitante' | 'ia' | 'sistema'

export interface Ator {
    /** Como veio da trilha. Fica para quem precisar correlacionar. */
    bruto: string
    tipo: TipoDeAtor
    /** O id dentro do tipo. Vazio para `ia` e `sistema`, que não têm. */
    id: string
    /** O nome, quando encontrado. Cai no id quando não. */
    nome: string
}

/**
 * Lê `tipo:id` sem decidir o nome.
 *
 * Separado da busca de propósito: isto é regra pura, roda em teste sem banco, e
 * a resolução de nome precisa de uma consulta que nem todo chamador quer fazer.
 */
export function lerAtor(bruto: string): Omit<Ator, 'nome'> {
    const separador = bruto.indexOf(':')
    const prefixo = separador === -1 ? bruto : bruto.slice(0, separador)
    const id = separador === -1 ? '' : bruto.slice(separador + 1)

    if (prefixo === 'agent' || prefixo === 'agente') return { bruto, tipo: 'agente', id }
    if (prefixo === 'requester' || prefixo === 'solicitante') {
        return { bruto, tipo: 'solicitante', id }
    }
    if (prefixo === 'ia') return { bruto, tipo: 'ia', id: '' }

    /// Tudo o mais é o sistema: cron, fila, migração. Eles não têm id e não
    /// precisam ter — ninguém pergunta QUAL cron fechou o chamado.
    return { bruto, tipo: 'sistema', id: '' }
}

/** O rótulo de quem não é pessoa. */
const SEM_NOME: Record<'ia' | 'sistema', string> = {
    ia: 'IA',
    sistema: 'Sistema',
}

/**
 * Resolve os atores de uma trilha inteira, com UMA consulta por tipo.
 *
 * Em lote, e não um por evento: um chamado com trinta eventos do mesmo agente
 * faria trinta consultas idênticas, e a tela do chamado é a mais aberta do
 * Console.
 *
 * Nome não encontrado cai no id, e não em "desconhecido": agente desativado e
 * solicitante removido continuam tendo feito o que fizeram, e apagar o rastro
 * deles da leitura é pior que mostrar um id.
 */
export async function resolverAtores(
    brutos: string[],
    buscar: {
        agentes: (ids: string[]) => Promise<{ id: string; nome: string }[]>
        solicitantes: (ids: string[]) => Promise<{ id: string; nome: string }[]>
    }
): Promise<Map<string, Ator>> {
    const lidos = [...new Set(brutos)].map(lerAtor)

    const idsPorTipo = (tipo: TipoDeAtor) =>
        [...new Set(lidos.filter((a) => a.tipo === tipo && a.id !== '').map((a) => a.id))]

    const [agentes, solicitantes] = await Promise.all([
        buscar.agentes(idsPorTipo('agente')),
        buscar.solicitantes(idsPorTipo('solicitante')),
    ])

    const nomes = new Map<string, string>()
    for (const { id, nome } of [...agentes, ...solicitantes]) nomes.set(id, nome)

    const resolvidos = new Map<string, Ator>()
    for (const ator of lidos) {
        const nome =
            ator.tipo === 'ia' || ator.tipo === 'sistema'
                ? SEM_NOME[ator.tipo]
                : (nomes.get(ator.id) ?? ator.id)

        resolvidos.set(ator.bruto, { ...ator, nome })
    }

    return resolvidos
}
