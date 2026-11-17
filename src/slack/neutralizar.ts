/**
 * Neutraliza texto escrito pelo usuário antes de ele entrar numa mensagem do
 * Slack.
 *
 * **Por que isto existe.** O canal de suporte tem o Claude escutando. Tudo o
 * que o Bridge publica ali é lido por um modelo — e o texto do solicitante é,
 * por definição, escrito por alguém de fora. A seção 8 fecha isso em duas
 * frentes: o conteúdo do chamado o Claude lê por ferramenta, em campo rotulado,
 * e nunca é colado na mensagem. O que sobra de texto do usuário na mensagem de
 * abertura é o ASSUNTO, e ele passa por aqui.
 *
 * **O que isto resolve e o que NÃO resolve.** Resolve o que é mecânico: menção
 * forjada, linha forjada, caractere que esconde conteúdo de um humano sem
 * escondê-lo do modelo. Não resolve — nem tenta — texto que simplesmente *diz*
 * algo persuasivo. Contra isso a defesa é outra, e está na seção 8: o campo vai
 * rotulado como dado do solicitante, e as instruções permanentes do canal
 * mandam tratá-lo como dado, nunca como instrução. Uma função que prometesse
 * detectar "instrução maliciosa" por padrão de texto daria uma sensação de
 * segurança que ela não teria como sustentar.
 */

/** Teto do campo na mensagem. O assunto já nasce limitado a 140 na abertura. */
export const TETO_PADRAO = 140

/**
 * Caracteres que mudam o que um humano vê sem mudar o que o modelo lê.
 *
 *  - `U+200B`–`U+200D`, `U+2060`, `U+FEFF` — largura zero: somem da tela do
 *    atendente e continuam no que o modelo recebe.
 *  - `U+202A`–`U+202E`, `U+2066`–`U+2069` — sobrescrita bidirecional. É o
 *    truque do "trojan source": o humano lê uma coisa, o interpretador lê
 *    outra.
 *  - controle, **menos** tabulação, nova linha e retorno de carro. Esses
 *    três passam de propósito, para o colapso de espaço logo abaixo virar
 *    UM espaço. Removê-los aqui colaria as palavras dos dois lados:
 *    `pedido` + nova linha + `Tenant:` viraria `pedidoTenant:`, e o
 *    atendente perderia a fronteira que precisa enxergar.
 *
 * A classe vai em escapes `\uXXXX`, e não nos caracteres: caractere
 * invisível dentro do código é exatamente o que esta função existe para
 * tirar de outro lugar.
 */
const INVISIVEIS =
    /[\u200B-\u200D\u2060\uFEFF\u202A-\u202E\u2066-\u2069\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/**
 * Escapa os três caracteres que o Slack trata como estrutura.
 *
 * É o que impede menção forjada: uma menção de verdade é `<@U123>`, o aviso de
 * canal é `<!channel>` e um link é `<https://x|texto>`. Sem `<` e `>` literais,
 * nenhuma dessas formas nasce do texto do solicitante — então ele não consegue
 * notificar o canal inteiro nem fingir ser um link para outro lugar.
 * `@channel` em texto puro, depois disto, é só a palavra.
 */
function escaparParaSlack(bruto: string): string {
    return bruto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function neutralizar(bruto: string, teto = TETO_PADRAO): string {
    const semInvisiveis = bruto.replace(INVISIVEIS, '')

    /**
     * Tudo numa linha só.
     *
     * É a parte menos óbvia e a mais importante. A mensagem de abertura tem
     * linhas com significado — `Tenant:`, `Módulo:`, `Chamado:`. Um assunto com
     * quebra de linha forjaria uma delas: bastaria escrever
     * `pedido` + nova linha + `Tenant: Outra Clínica (plano Enterprise)` para o
     * atendente, e o modelo, lerem um tenant que não é o do chamado.
     */
    const umaLinha = semInvisiveis.replace(/\s+/g, ' ').trim()

    const cortado = umaLinha.length > teto ? `${umaLinha.slice(0, teto - 1).trimEnd()}…` : umaLinha

    return escaparParaSlack(cortado)
}
