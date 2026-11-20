import { ErroDeExtracao, type Vocabulario } from '../tipos.ts'

/**
 * As regras de produto, de `PRODUCT.md` — determinístico, por título.
 *
 * O arquivo é prosa em markdown com seções numeradas (`## 1. Período de
 * avaliação`), então não há o que o modelo acrescente: o texto já está escrito
 * para gente ler. O trabalho é cortar nas seções e escolher quais entram.
 *
 * **A escolha é uma allowlist, não um filtro.** As seções 13 e 14 são decisões
 * internas do gateway de pagamento e um inventário do que ainda não existe
 * ("'plano ativo' significa 'clicou no botão', não 'pagou'"). Nenhuma das duas
 * é resposta a cliente, e as duas estariam entre as mais tentadoras para um
 * agente citar. Por isso a lista diz quais entram, e não quais ficam de fora:
 * uma seção 15 nova chega silenciosa e não publicada.
 */

export const SECOES_PUBLICAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]

export interface SecaoDoProduto {
    numero: number
    titulo: string
    corpo: string
}

/**
 * As seções e o vocabulário em que elas foram ESCRITAS.
 *
 * O `PRODUCT.md` fala em clínica e paciente porque o Odontobox foi o primeiro
 * produto. Para os outros dois, a renderização troca as palavras — e precisa
 * saber de quais partir. Guardar isso aqui, junto do que foi extraído, evita
 * que o renderizador adivinhe ou que alguém o fixe no código.
 */
export interface Produto {
    secoes: SecaoDoProduto[]
    vocabularioDaFonte: Vocabulario
    /** O app cujo vocabulário escreveu o arquivo. */
    appDaFonte: string
}

const TITULO = /^## (\d+)\.\s+(.+)$/gm
const CORPO_MAXIMO = 18_000

export function extrairProduto(markdown: string): SecaoDoProduto[] {
    const marcas = [...markdown.matchAll(TITULO)]
    if (marcas.length === 0) throw new ErroDeExtracao('produto', 'nenhuma seção `## N. Título` no arquivo')

    const secoes: SecaoDoProduto[] = []
    for (const [i, marca] of marcas.entries()) {
        const numero = Number(marca[1])
        if (!SECOES_PUBLICAS.includes(numero)) continue

        const inicio = (marca.index ?? 0) + marca[0].length
        const fim = marcas[i + 1]?.index ?? markdown.length
        const corpo = markdown.slice(inicio, fim).trim()
        if (corpo.length < 40) continue

        secoes.push({
            numero,
            titulo: (marca[2] ?? '').trim(),
            /// Seção longa é cortada na última linha inteira: metade de um
            /// parágrafo é pior que um parágrafo a menos.
            corpo: corpo.length <= CORPO_MAXIMO ? corpo : `${corpo.slice(0, corpo.lastIndexOf('\n', CORPO_MAXIMO))}\n\n(texto cortado por tamanho)`,
        })
    }

    if (secoes.length === 0) throw new ErroDeExtracao('produto', 'nenhuma seção pública foi encontrada')
    return secoes
}
