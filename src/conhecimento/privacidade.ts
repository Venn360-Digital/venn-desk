import { dobrar } from '../dominio/busca.ts'

/**
 * A guarda de dado pessoal da biblioteca de casos.
 *
 * Um chamado resolvido é a melhor fonte de artigo que existe: alguém
 * descreveu o problema real e um humano resolveu. Mas o texto do chamado é do
 * cliente, e carrega e-mail, telefone, CPF, nome de paciente e link com token
 * de sessão. Um artigo PUBLICADO é visível a quem abrir chamado em qualquer
 * conta do app — vazar ali é vazar para todo mundo.
 *
 * Por isso a mesma coisa é feita duas vezes, nas duas pontas:
 *
 * 1. `anonimizar` roda ANTES do modelo. O que não chega ao prompt não volta
 *    na resposta, e não fica em log de provedor.
 * 2. `contemDadoPessoal` roda DEPOIS, na saída. Se o modelo reintroduziu algo
 *    — porque o cliente escreveu o telefone em palavras, porque o nome estava
 *    colado na frase — a sugestão é recusada em vez de corrigida. Corrigir
 *    seria adivinhar; recusar custa um rascunho.
 *
 * Os detectores erram para o lado de recusar. Um falso positivo deixa de
 * gerar um rascunho que ninguém pediu; um falso negativo publica o telefone
 * de um paciente.
 */

export type TipoDeDado = 'e-mail' | 'telefone' | 'cpf' | 'cnpj' | 'cep' | 'cartao' | 'url-com-token' | 'nome'

interface Detector {
    tipo: TipoDeDado
    padrao: RegExp
    rotulo: string
}

/**
 * A ORDEM importa, e é a parte fácil de errar.
 *
 * CNPJ antes de CPF (o começo de um CNPJ formatado casa com CPF), e os dois
 * antes de telefone (`11987654321` e `12345678901` têm 11 dígitos). Quem roda
 * telefone primeiro transforma CPF em `[telefone]` e passa a achar que não
 * havia CPF.
 */
const DETECTORES: Detector[] = [
    { tipo: 'e-mail', padrao: /[\w.+-]+@[\w-]+\.[\w.-]*[a-z]{2,}/gi, rotulo: '[e-mail]' },
    { tipo: 'url-com-token', padrao: /https?:\/\/\S*(?:token|jwt|chave|senha|secret|acesso)=\S+/gi, rotulo: '[link]' },
    /// URL com um segmento comprido e sem vogal de palavra: assinatura, id de
    /// sessão, hash de convite.
    { tipo: 'url-com-token', padrao: /https?:\/\/\S*\/[A-Za-z0-9_-]{20,}\S*/g, rotulo: '[link]' },
    { tipo: 'cnpj', padrao: /\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\b/g, rotulo: '[CNPJ]' },
    { tipo: 'cpf', padrao: /\b\d{3}\.\d{3}\.\d{3}-?\d{2}\b/g, rotulo: '[CPF]' },
    { tipo: 'cartao', padrao: /\b(?:\d{4}[ .-]){3}\d{4}\b/g, rotulo: '[cartão]' },
    { tipo: 'cep', padrao: /\b\d{5}-\d{3}\b/g, rotulo: '[CEP]' },
    /// Telefone com DDD, com ou sem parênteses, com ou sem o nono dígito.
    { tipo: 'telefone', padrao: /(?:\+?55[\s.-]?)?\(?\b\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g, rotulo: '[telefone]' },
    /// CPF e cartão escritos sem pontuação só se distinguem pelo tamanho.
    { tipo: 'cpf', padrao: /\b\d{11}\b/g, rotulo: '[CPF]' },
    { tipo: 'cartao', padrao: /\b\d{13,16}\b/g, rotulo: '[cartão]' },
]

/**
 * As palavras do nome que valem procurar.
 *
 * "de", "da", "dos" aparecem em meio nome do Brasil e em metade das frases —
 * substituí-las apagaria o texto. Palavra de três letras ou menos fica fora
 * pelo mesmo motivo: "Ana" é nome, mas "ana" está dentro de "semana".
 */
function partesDoNome(nomes: string[]): string[] {
    const partes = nomes
        .flatMap((n) => n.split(/\s+/))
        .map((p) => dobrar(p).replace(/[^a-z0-9]/g, ''))
        .filter((p) => p.length > 3)
    return [...new Set(partes)]
}

/**
 * Troca cada dado pessoal por um rótulo, mantendo a frase legível.
 *
 * O modelo precisa entender o problema — "não consigo convidar a recepção" —
 * sem saber quem é a recepção. Rótulo em vez de remoção porque uma frase com
 * buraco faz o modelo preencher o buraco.
 */
export function anonimizar(texto: string, nomes: string[] = []): string {
    let saida = texto
    for (const d of DETECTORES) saida = saida.replace(d.padrao, d.rotulo)

    const partes = partesDoNome(nomes)
    if (partes.length === 0) return saida

    /**
     * Palavra a palavra, comparando dobrado: o cliente escreve "joao" onde o
     * cadastro diz "João", e um `replace` do literal não acharia. `\p{L}`
     * mantém o acento dentro da palavra para poder dobrá-la inteira.
     */
    return saida.replace(/[\p{L}][\p{L}\d'-]*/gu, (palavra) => {
        const limpa = dobrar(palavra).replace(/[^a-z0-9]/g, '')
        return partes.includes(limpa) ? '[nome]' : palavra
    })
}

export interface Achado {
    tipo: TipoDeDado
    /** Um pedaço curto, para a trilha. Nunca o dado inteiro. */
    amostra: string
}

/**
 * O que ainda parece dado pessoal no texto.
 *
 * Devolve lista, não booleano, porque o evento de recusa precisa dizer o que
 * encontrou — sem registrar o valor, só o tipo e uma amostra curta.
 */
export function dadosPessoaisEm(texto: string, nomes: string[] = []): Achado[] {
    const achados: Achado[] = []
    let restante = texto

    for (const d of DETECTORES) {
        const casos = restante.match(d.padrao)
        if (casos === null) continue
        achados.push({ tipo: d.tipo, amostra: amostrar(casos[0]) })
        /// Consome o que já foi contado, para o detector seguinte não contar o
        /// mesmo pedaço com outro nome.
        restante = restante.replace(d.padrao, ' ')
    }

    for (const parte of partesDoNome(nomes)) {
        const temNome = restante.match(/[\p{L}][\p{L}\d'-]*/gu)?.some((p) => dobrar(p).replace(/[^a-z0-9]/g, '') === parte)
        if (temNome === true) {
            achados.push({ tipo: 'nome', amostra: `${parte.slice(0, 3)}…` })
            break
        }
    }

    return achados
}

/** Três caracteres bastam para reconhecer o tipo na trilha e não vazam o dado. */
function amostrar(valor: string): string {
    return `${valor.slice(0, 3)}…${valor.length > 3 ? `(${valor.length})` : ''}`
}
