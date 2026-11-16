/**
 * Erros do domínio, com o código que vira resposta HTTP.
 *
 * O texto nunca expõe detalhe interno de código ou de infraestrutura — regra da
 * seção 10, que vale para a resposta ao usuário e para a mensagem no Slack.
 *
 * **Sem parameter property no construtor**, de propósito: o Node remove tipos
 * em modo "strip-only" e recusa essa sintaxe
 * (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`). Escrito assim, qualquer `.ts` deste
 * repositório roda com `node arquivo.ts` — é o que permite à semente e aos
 * scripts dispensarem `tsx`.
 */
export class ErroDeDominio extends Error {
    readonly codigo: string
    readonly status: number

    constructor(codigo: string, mensagem: string, status = 422) {
        super(mensagem)
        this.name = 'ErroDeDominio'
        this.codigo = codigo
        this.status = status
    }
}

export class ErroDeToken extends ErroDeDominio {
    constructor(codigo: string, mensagem: string) {
        super(codigo, mensagem, 401)
        this.name = 'ErroDeToken'
    }
}
