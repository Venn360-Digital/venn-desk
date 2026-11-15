/**
 * Erros do domínio, com o código que vira resposta HTTP.
 *
 * O texto nunca expõe detalhe interno de código ou de infraestrutura — regra da
 * seção 10, que vale para a resposta ao usuário e para a mensagem no Slack.
 */
export class ErroDeDominio extends Error {
    constructor(
        readonly codigo: string,
        mensagem: string,
        readonly status = 422
    ) {
        super(mensagem)
        this.name = 'ErroDeDominio'
    }
}

export class ErroDeToken extends ErroDeDominio {
    constructor(codigo: string, mensagem: string) {
        super(codigo, mensagem, 401)
        this.name = 'ErroDeToken'
    }
}
