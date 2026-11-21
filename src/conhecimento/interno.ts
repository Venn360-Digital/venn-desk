/**
 * O que é detalhe INTERNO e não pode aparecer em texto que o cliente lê.
 *
 * Mora fora de `extrair/tela.ts` porque duas coisas precisam da mesma lista: a
 * documentação de tela, que a extrai do código, e a biblioteca de casos, que a
 * extrai de uma nota interna escrita por um atendente. A segunda é a mais
 * perigosa — a nota interna existe justamente para dizer "o `productService`
 * não estava devolvendo a duração", e é dali que a sugestão sai.
 */
const PADROES_INTERNOS = [
    /\b[\w-]+\.tsx?\b/,
    /\/api\//,
    /\bprisma\b/i,
    /\buseState\b|\buseEffect\b/,
    /\bselect\b.*\bfrom\b/i,
    /\bworkspaceId\b|\btenantId\b|\bappId\b/,
    /\b[a-z][a-zA-Z]*(?:Service|Repository|Controller|Handler|Provider|Client|Dto)\b/,
]

/** Os textos que carregam detalhe interno. Vazio é o que se espera. */
export function detalheInternoEm(textos: string[]): string[] {
    return textos.filter((t) => PADROES_INTERNOS.some((re) => re.test(t)))
}
