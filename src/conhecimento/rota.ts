import { resolverPlaceholders } from './renderizar/vocabulario.ts'
import type { Menu } from './extrair/menu.ts'
import type { Vocabulario } from './tipos.ts'

/**
 * O nome da tela em que o cliente estava, a partir do `contexto.rota` que o
 * widget manda no chamado.
 *
 * "/vendas/servicos" não diz nada a quem atende; "Vendas → Procedimentos" diz.
 * O mapa do menu já tem `segmentos` (segmento de URL → rótulo), inclusive os
 * slugs antigos que a trilha ainda resolve — é exatamente a tabela que
 * `crumbsFor` usa no produto, então o nome aqui é o mesmo que o cliente vê.
 */
/**
 * O que num endereço é "um item" e não o nome de um lugar.
 *
 * Três formas: o número, o identificador longo que o produto gera, e o
 * segmento dinâmico do próprio código (`[id]`, `[token]`) — este último
 * aparecia cru no título do artigo ("Formulários → [id]"), o que não é nome de
 * tela nenhum.
 */
const PARECE_ID = /^(?:\[[^\]]+\]|[0-9]+|[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,})$/i

export function nomeDaTela(rota: string, menu: Menu, v: Vocabulario): string | null {
    /// Menu malformado (artigo de outra versão, `dados` corrompido) não derruba
    /// quem chamou: sem tabela de segmentos não há nome, e dizer o endereço é
    /// melhor que falhar a documentação de uma tela inteira.
    const tabela = menu?.segmentos
    if (tabela === undefined || tabela === null || typeof tabela !== 'object') return null

    const segmentos = rota.split('?')[0]?.split('/').filter((s) => s !== '') ?? []
    if (segmentos.length === 0) return null

    const partes: string[] = []
    let conhecidos = 0
    for (const seg of segmentos) {
        if (PARECE_ID.test(seg)) {
            partes.push('(um item)')
            continue
        }
        const rotulo = tabela[seg]
        if (rotulo === undefined) {
            partes.push(seg)
            continue
        }
        conhecidos++
        partes.push(resolverPlaceholders(rotulo, v))
    }

    return conhecidos === 0 ? null : partes.join(' → ')
}
