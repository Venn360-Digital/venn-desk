import { escapar, type Idioma } from './modelos.ts'

/**
 * O e-mail do portal de contingência (seção 7, item 3).
 *
 * Separado de `modelos.ts` porque não é um momento do chamado: os três momentos
 * de lá falam SOBRE um chamado e carregam número e assunto. Este fala sobre o
 * acesso, e acontece quando o app está fora do ar — é a única mensagem do Venn
 * Desk que existe para o caso de o resto não existir.
 *
 * **O link é a credencial.** Por isso o texto diz a validade e diz para não
 * repassar. E por isso ele nunca leva número de chamado nem assunto no corpo:
 * quem pediu o acesso ainda não provou ser o dono da caixa quando a mensagem é
 * escrita — a prova é abrir o e-mail.
 */

const TEXTOS: Record<Idioma, Record<string, string>> = {
    'pt-BR': {
        assunto: 'Seu acesso ao suporte do {app}',
        ola: 'Olá, {nome}.',
        corpo:
            'Você pediu acesso aos seus chamados do {app} fora do aplicativo. O botão abaixo abre a sua central de suporte.',
        botao: 'Abrir meus chamados',
        validade: 'O link vale por {minutos} minutos e serve só para você. Não o repasse.',
        naoPediu: 'Se não foi você que pediu, ignore este e-mail: nada foi aberto.',
        rodape: 'Venn Desk · suporte do {app}',
    },
    en: {
        assunto: 'Your access to {app} support',
        ola: 'Hi {nome},',
        corpo:
            'You asked for access to your {app} tickets outside the application. The button below opens your support centre.',
        botao: 'Open my tickets',
        validade: 'The link is valid for {minutos} minutes and is yours alone. Do not forward it.',
        naoPediu: 'If this was not you, ignore this email: nothing was opened.',
        rodape: 'Venn Desk · {app} support',
    },
    es: {
        assunto: 'Su acceso al soporte de {app}',
        ola: 'Hola, {nome}.',
        corpo:
            'Pidió acceso a sus casos de {app} fuera de la aplicación. El botón de abajo abre su central de soporte.',
        botao: 'Abrir mis casos',
        validade: 'El enlace vale por {minutos} minutos y es solo suyo. No lo reenvíe.',
        naoPediu: 'Si no fue usted, ignore este correo: no se abrió nada.',
        rodape: 'Venn Desk · soporte de {app}',
    },
}

export interface DadosDaEntrada {
    nomeDoApp: string
    nomeDoUsuario: string
    link: string
    minutos: number
}

const preencher = (modelo: string, valores: Record<string, string>) =>
    modelo.replace(/\{(\w+)\}/g, (_, chave: string) => valores[chave] ?? '')

export function montarEntrada(
    idioma: Idioma,
    dados: DadosDaEntrada
): { assunto: string; texto: string; html: string } {
    const t = TEXTOS[idioma]
    const v = {
        app: dados.nomeDoApp,
        nome: dados.nomeDoUsuario,
        minutos: String(dados.minutos),
    }

    const assunto = preencher(t['assunto'] ?? '', v)

    /// A parte texto vai sempre: e-mail só-HTML pesa contra a entrega de um
    /// domínio de envio sem reputação — e este é o e-mail que menos pode cair
    /// em spam, porque sai quando o app já está fora.
    const texto = [
        preencher(t['ola'] ?? '', v),
        '',
        preencher(t['corpo'] ?? '', v),
        '',
        `${t['botao']}: ${dados.link}`,
        '',
        preencher(t['validade'] ?? '', v),
        preencher(t['naoPediu'] ?? '', v),
        preencher(t['rodape'] ?? '', v),
    ].join('\n')

    const html = `<!doctype html>
<html lang="${idioma}"><body style="margin:0;background:#f6f7f9;font:15px/1.6 -apple-system,Segoe UI,sans-serif;color:#1b1d22">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="background:#fff;border:1px solid #e3e6ec;border-radius:10px;padding:22px">
      <p style="margin:0 0 12px">${escapar(preencher(t['ola'] ?? '', v))}</p>
      <p style="margin:0 0 8px">${escapar(preencher(t['corpo'] ?? '', v))}</p>
      <p style="margin:20px 0 0">
        <a href="${escapar(dados.link)}" style="display:inline-block;background:#2b6cb0;color:#fff;text-decoration:none;padding:10px 16px;border-radius:7px;font-weight:600">${escapar(t['botao'] ?? '')}</a>
      </p>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280">${escapar(preencher(t['validade'] ?? '', v))}</p>
    <p style="margin:6px 0 0;font-size:12px;color:#6b7280">${escapar(preencher(t['naoPediu'] ?? '', v))}</p>
    <p style="margin:6px 0 0;font-size:12px;color:#6b7280">${escapar(preencher(t['rodape'] ?? '', v))}</p>
  </div>
</body></html>`

    return { assunto, texto, html }
}
