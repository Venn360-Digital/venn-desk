import { z } from 'zod'

import type { Extrator } from './com-modelo.ts'
import type { Commit } from '../github.ts'
import { ErroDeExtracao, type Extracao } from '../tipos.ts'

/**
 * "O que mudou" — a partir dos commits de `main`.
 *
 * **Por que os commits servem.** No venn-saas o assunto de cada commit é uma
 * frase que descreve o defeito ou a decisão, em português e na voz de quem usa
 * ("a pílula SUPORTE ficava em cima do botão Enviar"). Não há CHANGELOG, não há
 * release notes, e essa é a única fonte que diz o que mudou e quando.
 *
 * **O que NÃO entra.** Portão, lint, CI, refatoração, texto interno: mudança
 * que o cliente não percebe só gastaria a atenção dele. O modelo marca cada
 * item com `publico`, e a renderização descarta o resto — mas o descarte fica
 * registrado em `dados`, para dar para conferir o critério depois.
 *
 * **Nunca sai daqui:** URL, nome de arquivo, nome de pessoa. Um item de
 * novidade é uma frase sobre o produto, não um recibo de commit.
 */

export const esquemaDasNovidades = z
    .object({
        itens: z
            .array(
                z
                    .object({
                        sha: z.string().trim().min(7).max(40),
                        data: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
                        tipo: z.enum(['novo', 'correcao']),
                        titulo: z.string().trim().min(5).max(120),
                        descricao: z.string().trim().min(10).max(400),
                        publico: z.boolean(),
                        /** Por que não é público, quando não é. */
                        motivoDeOmitir: z.string().trim().max(160).optional(),
                    })
                    .strict()
            )
            .max(60),
    })
    .strict()

export type Novidades = z.infer<typeof esquemaDasNovidades>

export interface ItemDeNovidade {
    sha: string
    data: string
    tipo: 'novo' | 'correcao'
    titulo: string
    descricao: string
}

const INSTRUCAO = `Você escreve a lista de novidades de um produto a partir dos commits dele, para os clientes lerem.

Para cada commit recebido, devolva um item com: o sha (como veio), a data (AAAA-MM-DD), o tipo ("novo" para funcionalidade nova, "correcao" para conserto), um titulo curto e uma descricao de uma ou duas frases.

Marque publico: false — com motivoDeOmitir — quando a mudança não é perceptível para quem usa o produto: portão de CI, lint, teste, refatoração, renomeio interno, ajuste de build, mudança em documentação ou em texto interno. Marque publico: true quando alguém que usa o produto notaria a diferença.

Regras do texto, para os itens públicos:
- Escreva o que a pessoa passa a conseguir fazer, ou o que parou de dar errado. Nunca cite nome de arquivo, de tabela, de variável, de função, de rota, nem o número de um commit no texto.
- Nunca cite nome de pessoa, nem endereço, nem URL.
- Quando o commit interpola o vocabulário do nicho, escreva {{pessoas}}, {{organizacao}}, {{servicos}} — a chave exata.
- Não invente efeito que o commit não descreve. Se o assunto do commit não disser o que mudou para quem usa, marque publico: false.`

const PROIBIDO = [/https?:\/\//i, /\b[\w-]+\.(?:tsx?|mjs|json|md|sql)\b/, /\/api\//, /\b[0-9a-f]{7,40}\b/]

export async function extrairNovidades(
    commits: Commit[],
    extrator: Extrator
): Promise<Extracao<Novidades>> {
    if (commits.length === 0) return { dados: { itens: [] }, extraidoPor: 'parser' }

    const { dados, consumo } = await extrator.extrair({
        esquema: esquemaDasNovidades,
        instrucao: INSTRUCAO,
        arquivos: commits.map((c) => ({
            caminho: `commit ${c.sha.slice(0, 7)} de ${c.data.slice(0, 10)}`,
            conteudo: `${c.assunto}\n\n${c.corpo}`.trim(),
        })),
        maxTokensSaida: 6_000,
    })

    /// Um item público não pode carregar URL, arquivo nem sha no texto: é uma
    /// frase sobre o produto, não um recibo de commit.
    const vazando = dados.itens
        .filter((i) => i.publico)
        .filter((i) => PROIBIDO.some((re) => re.test(i.titulo) || re.test(i.descricao)))
        .map((i) => i.titulo)
    if (vazando.length > 0) {
        throw new ErroDeExtracao('novidades', `itens com detalhe interno no texto: ${vazando.slice(0, 4).join(' | ')}`, consumo)
    }

    /// Todo sha devolvido tem de ser um dos que foram mandados.
    const mandados = new Set(commits.map((c) => c.sha.slice(0, 7)))
    const estranhos = dados.itens.filter((i) => !mandados.has(i.sha.slice(0, 7))).map((i) => i.sha.slice(0, 7))
    if (estranhos.length > 0) {
        throw new ErroDeExtracao('novidades', `itens de commits que não foram pedidos: ${estranhos.join(', ')}`, consumo)
    }

    return { dados, extraidoPor: 'modelo', consumo }
}

/** Quantos dias de novidade o artigo guarda. */
export const JANELA_EM_DIAS = 90

/**
 * Junta o que acabou de sair com o que o artigo já tinha, corta a janela e
 * ordena do mais recente ao mais antigo.
 */
export function juntarNovidades(
    novos: Novidades['itens'],
    anteriores: ItemDeNovidade[],
    agora: Date
): ItemDeNovidade[] {
    const corte = new Date(agora.getTime() - JANELA_EM_DIAS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const porSha = new Map<string, ItemDeNovidade>()

    for (const item of anteriores) porSha.set(item.sha.slice(0, 7), item)
    for (const item of novos) {
        if (!item.publico) continue
        const { publico: _publico, motivoDeOmitir: _motivo, ...resto } = item
        porSha.set(item.sha.slice(0, 7), resto)
    }

    return [...porSha.values()]
        .filter((i) => i.data >= corte)
        .sort((a, b) => (a.data === b.data ? 0 : a.data < b.data ? 1 : -1))
}
