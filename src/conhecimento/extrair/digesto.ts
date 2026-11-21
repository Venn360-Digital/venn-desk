/**
 * O digesto de um arquivo de interface: só os TEXTOS que aparecem na tela.
 *
 * **Por que existe, medido em 20/11/2026.** A tela de conversas é um arquivo de
 * 261 KB — cerca de 65 mil tokens. Mandá-lo cru ao modelo custaria caro, e o
 * modelo se perderia em duas mil linhas de estado para achar o que a
 * documentação precisa. Os literais de interface daquele mesmo arquivo somam
 * 2,7 KB: 95 vezes menos, e são justamente as âncoras que a verificação exige
 * ("o botão se chama Transferir" só vale se "Transferir" estiver no arquivo).
 *
 * Então o prompt leva o digesto, e a ANCORAGEM continua rodando contra o
 * arquivo cru — o digesto é o que o modelo lê, o arquivo é a verdade.
 *
 * **Determinístico e estreito.** Regex sobre padrões de interface conhecidos,
 * nunca "qualquer string": classe de Tailwind, nome de variável e caminho de
 * import não são texto de tela, e deixá-los entrar encheria o prompt de ruído
 * que o modelo poderia repetir como se fosse rótulo.
 */

import { PALAVRAS_DO_VOCABULARIO } from '../tipos.ts'

export interface Digesto {
    /** `aria-label`, `title`, `alt`: o que um leitor de tela anuncia. */
    acessibilidade: string[]
    /** `placeholder`: o que o campo sugere antes de alguém escrever. */
    placeholders: string[]
    /** Rótulos de campo, coluna, aba e botão. */
    rotulos: string[]
    /** Texto solto no JSX: títulos, parágrafos, estados vazios. */
    textos: string[]
    /** `toast.success`, `toast.error`: o que o sistema responde a uma ação. */
    avisos: string[]
    /** Nomes das funções de ação (`handleSalvar`, `aoExcluir`). */
    acoes: string[]
}

/** Classe de CSS, caminho, identificador: parece texto e não é. */
const RUIDO =
    /^(?:[a-z0-9-]+:)?(?:flex|grid|block|hidden|absolute|relative|w-|h-|p[xytblr]?-|m[xytblr]?-|gap-|text-|bg-|border|rounded|shadow|overflow|truncate|items-|justify-|space-|min-|max-|top-|left-|right-|bottom-|z-|opacity-|cursor-|transition|duration|animate|font-|leading-|tracking-|whitespace|select-|pointer-|ring-|outline|sr-only|col-|row-|order-|basis-|shrink|grow|inline|table|sticky|fixed|static|invisible|visible|aspect-|object-|divide-|from-|via-|to-)/
const SO_SIMBOLO = /^[^\p{L}]*$/u
const CAMINHO = /^[./@]|\/(?:api|components|lib|hooks)\//
/**
 * Interpolação que o digesto NÃO entende fica fora: `${total}` no texto
 * publicado seria lixo.
 *
 * O marcador do vocabulário é a exceção, e por isso é testado antes: ele é a
 * única interpolação que o resto do caminho sabe resolver (`ancorar.ts` o
 * ignora na verificação, `resolverPlaceholders` o troca pelo vocabulário de
 * cada app). Sem esta exceção o filtro descartava exatamente o que a conversão
 * acabou de produzir, e o marcador nunca chegava ao modelo.
 */
const MARCADOR_DO_VOCABULARIO = /\{\{[A-Za-z]+\}\}/g
const INTERPOLADO = /\$\{|\{\{/

function limpar(bruto: string): string | null {
    const t = bruto.replace(/\s+/g, ' ').trim()
    if (t.length < 3 || t.length > 200) return null
    if (SO_SIMBOLO.test(t)) return null
    if (RUIDO.test(t)) return null
    if (CAMINHO.test(t)) return null
    if (INTERPOLADO.test(t.replace(MARCADOR_DO_VOCABULARIO, ''))) return null
    /// Sem nenhuma vogal não é palavra de gente; `camelCase` sem espaço e sem
    /// acento quase sempre é identificador.
    /// A vogal e o camelCase são medidos no texto SEM o marcador: `{{Servico}}`
    /// sozinho não tem vogal fora do próprio marcador, e seria descartado.
    const semMarcador = t.replace(MARCADOR_DO_VOCABULARIO, '').trim()
    if (semMarcador !== '') {
        if (!/[aeiouáâãàéêíóôõúüAEIOU]/.test(semMarcador)) return null
        if (!t.includes(' ') && /^[a-z]+[A-Z]/.test(semMarcador)) return null
    }
    return t
}

function colher(texto: string, padrao: RegExp, grupo = 1): string[] {
    const achados = new Set<string>()
    for (const m of texto.matchAll(padrao)) {
        const limpo = limpar(m[grupo] ?? '')
        if (limpo !== null) achados.add(limpo)
    }
    return [...achados]
}

const ASPAS = `(?:"([^"]+)"|'((?:[^'\\\\]|\\\\.)*)')`

/** Colhe de um atributo JSX, aceitando aspas simples ou duplas. */
function doAtributo(texto: string, atributos: string[]): string[] {
    const achados = new Set<string>()
    for (const attr of atributos) {
        const re = new RegExp(`\\b${attr}\\s*=\\s*${ASPAS}`, 'g')
        for (const m of texto.matchAll(re)) {
            const limpo = limpar((m[1] ?? m[2] ?? '').replace(/\\'/g, "'"))
            if (limpo !== null) achados.add(limpo)
        }
    }
    return [...achados]
}

/**
 * A interpolação do vocabulário vira o MARCADOR que o extrator deve devolver.
 *
 * Medido em 21/11/2026: das 32 telas documentadas, nenhuma devolveu um único
 * marcador, embora a instrução peça. O motivo não era o modelo desobedecendo —
 * era o digesto. `label: ${v.Servico}` é template literal, e os padrões de
 * rótulo só colhiam aspas; `{v.Servicos}` em JSX era excluído pela classe que
 * proíbe chaves. A informação nunca chegava ao prompt, então o modelo escrevia
 * a palavra do app base e os três apps publicavam a mesma.
 *
 * Convertido aqui, o resto do caminho já funciona: `ancorar.ts` ignora
 * marcador na verificação e `resolverPlaceholders` o troca pelo vocabulário de
 * cada app na renderização.
 */
function comMarcadoresDoVocabulario(texto: string): string {
    return texto.replace(
        /\$?\{\s*(?:v|vocab|vocabulario)\(?\)?\.([A-Za-z]+)\s*\}|\b(?:v|vocab|vocabulario)\(?\)?\.([A-Za-z]+)\b/g,
        (tudo, deChave: string | undefined, solta: string | undefined) => {
            const chave = deChave ?? solta ?? ''
            return (PALAVRAS_DO_VOCABULARIO as string[]).includes(chave) ? `{{${chave}}}` : tudo
        }
    )
}

export function digerir(conteudo: string): Digesto {
    /// Comentários fora: eles falam com quem programa, não com quem usa — e um
    /// comentário com instrução dentro não deve nem chegar ao prompt.
    const semComentarios = comMarcadoresDoVocabulario(
        conteudo
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/^[ \t]*\/\/.*$/gm, ' ')
            .replace(/^[ \t]*\/\/\/.*$/gm, ' ')
    )

    return {
        acessibilidade: doAtributo(semComentarios, ['aria-label', 'title', 'alt']),
        placeholders: doAtributo(semComentarios, ['placeholder']),
        rotulos: [
            ...new Set([
                ...doAtributo(semComentarios, ['label', 'rotulo', 'heading', 'header']),
                /// `label: 'Nome'` em objeto de coluna, aba, opção.
                ...colher(semComentarios, /\b(?:label|rotulo|titulo|nome)\s*:\s*'((?:[^'\\]|\\.)*)'/g),
                ...colher(semComentarios, /\b(?:label|rotulo|titulo|nome)\s*:\s*"([^"]+)"/g),
                /// Acento grave: é a forma em que o rótulo do vocabulário
                /// aparece (`label: \`{{Servico}}\``), e sem ela o filtro de
                /// categorias da tela de catálogo chegava ao modelo com uma
                /// opção a menos do que a tela mostra.
                ...colher(semComentarios, /\b(?:label|rotulo|titulo|nome)\s*:\s*`((?:[^`\\]|\\.)*)`/g),
            ]),
        ],
        textos: [
            ...new Set([
                /// Texto solto entre tags, que é o que se lê na tela.
                ...colher(semComentarios, />\s*([\p{Lu}\p{Ll}][^<>{}]{2,150}?)\s*</gu),
                /**
                 * O mesmo texto entre tags, quando traz marcador do
                 * vocabulário. Precisa de padrão próprio porque o de cima
                 * proíbe chaves — proibição que existe para não colher
                 * expressão JSX (`{pode ? 'a' : 'b'}`), e que também barrava
                 * `{{Pessoas}}`.
                 */
                ...colher(
                    semComentarios,
                    />\s*((?:[^<>{}]|\{\{[A-Za-z]+\}\})*\{\{[A-Za-z]+\}\}(?:[^<>{}]|\{\{[A-Za-z]+\}\})*)\s*</gu
                ),
                ...doAtributo(semComentarios, ['description', 'descricao', 'mensagem', 'message', 'texto', 'text']),
            ]),
        ],
        avisos: colher(semComentarios, /toast\.(?:success|error|info|warning|message)\(\s*(?:`|')((?:[^'`\\]|\\.)*)/g),
        acoes: [
            ...new Set(
                [...semComentarios.matchAll(/\b(?:const|function|async function)\s+((?:handle|ao|on)[A-Z]\w+)/g)].map(
                    (m) => m[1] ?? ''
                )
            ),
        ].filter((a) => a !== ''),
    }
}

/** O digesto em texto, para entrar no prompt. Vazio vira linha nenhuma. */
export function digestoEmTexto(d: Digesto): string {
    const secoes: [string, string[]][] = [
        ['Títulos e textos da tela', d.textos],
        ['Rótulos de campo, coluna e aba', d.rotulos],
        ['Sugestões de campo (placeholder)', d.placeholders],
        ['Rótulos de acessibilidade (o que cada botão faz)', d.acessibilidade],
        ['Avisos que o sistema dá depois de uma ação', d.avisos],
        ['Funções de ação no código', d.acoes],
    ]
    return secoes
        .filter(([, itens]) => itens.length > 0)
        .map(([nome, itens]) => `${nome}:\n${itens.map((i) => `- ${i}`).join('\n')}`)
        .join('\n\n')
}

/**
 * Acima disto, o arquivo vai como DIGESTO; abaixo, vai cru.
 *
 * Telas pequenas (a maioria: de 2 a 17 mil tokens) rendem documentação melhor
 * com o código inteiro, porque o fluxo está na lógica. A de conversas, com 65
 * mil, só cabe digerida.
 */
export const LIMITE_PARA_CRU = 24_000
