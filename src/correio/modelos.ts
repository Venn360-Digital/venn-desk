/**
 * Os modelos de e-mail, nos três idiomas (seção 7).
 *
 * Três momentos, e só três: abertura, atualização e encerramento. Nota interna,
 * classificação e troca de responsável NÃO geram e-mail — são movimento
 * interno, e avisar o cliente a cada um deles treina a pessoa a ignorar a
 * caixa.
 *
 * **Sem anexo e sem dado sensível no corpo.** O e-mail leva número, assunto, o
 * que mudou e um link. Anexo fica atrás do login (seção 10).
 */

export type Idioma = 'pt-BR' | 'en' | 'es'
export type Momento = 'abertura' | 'atualizacao' | 'encerramento'

export interface DadosDoEmail {
    numero: string
    assunto: string
    nomeDoApp: string
    nomeDoUsuario: string
    link: string
    /** Mensagens públicas desde o último aviso. Vazio na abertura. */
    mensagens: { autor: string; corpo: string }[]
    /** Só no encerramento. */
    solucao?: string
}

const TEXTOS: Record<Idioma, Record<string, string>> = {
    'pt-BR': {
        assuntoAbertura: '[{numero}] Recebemos seu chamado',
        assuntoAtualizacao: '[{numero}] Novidade no seu chamado',
        assuntoEncerramento: '[{numero}] Seu chamado foi resolvido',
        ola: 'Olá, {nome}.',
        aberturaCorpo:
            'Recebemos seu chamado {numero}: "{assunto}". Vamos avisar aqui a cada novidade.',
        atualizacaoCorpo: 'Há novidade no seu chamado {numero}: "{assunto}".',
        encerramentoCorpo:
            'Seu chamado {numero} — "{assunto}" — foi resolvido. Se não resolveu, responda pelo link abaixo e ele reabre.',
        verChamado: 'Abrir o chamado',
        naoResponda:
            'Este endereço não recebe respostas. Para responder, use o link acima, dentro do {app}.',
        rodape: 'Venn Desk · suporte do {app}',
    },
    en: {
        assuntoAbertura: '[{numero}] We received your ticket',
        assuntoAtualizacao: '[{numero}] Update on your ticket',
        assuntoEncerramento: '[{numero}] Your ticket was resolved',
        ola: 'Hi {nome},',
        aberturaCorpo:
            'We received your ticket {numero}: "{assunto}". We will keep you posted here.',
        atualizacaoCorpo: 'There is an update on your ticket {numero}: "{assunto}".',
        encerramentoCorpo:
            'Your ticket {numero} — "{assunto}" — was resolved. If it is not solved, reply through the link below and it reopens.',
        verChamado: 'Open the ticket',
        naoResponda:
            'This address does not accept replies. To reply, use the link above, inside {app}.',
        rodape: 'Venn Desk · {app} support',
    },
    es: {
        assuntoAbertura: '[{numero}] Recibimos tu ticket',
        assuntoAtualizacao: '[{numero}] Novedad en tu ticket',
        assuntoEncerramento: '[{numero}] Tu ticket fue resuelto',
        ola: 'Hola, {nome}.',
        aberturaCorpo:
            'Recibimos tu ticket {numero}: "{assunto}". Te avisaremos aquí de cada novedad.',
        atualizacaoCorpo: 'Hay una novedad en tu ticket {numero}: "{assunto}".',
        encerramentoCorpo:
            'Tu ticket {numero} — "{assunto}" — fue resuelto. Si no quedó resuelto, responde por el enlace de abajo y se reabre.',
        verChamado: 'Abrir el ticket',
        naoResponda:
            'Esta dirección no recibe respuestas. Para responder, usa el enlace de arriba, dentro de {app}.',
        rodape: 'Venn Desk · soporte de {app}',
    },
}

function preencher(modelo: string, valores: Record<string, string>): string {
    return Object.entries(valores).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), modelo)
}

/** Escapa o que vai para dentro do HTML. O texto é do usuário e do atendente. */
function escapar(bruto: string): string {
    return bruto
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')
}

export interface EmailMontado {
    assunto: string
    texto: string
    html: string
}

export function montar(momento: Momento, idioma: Idioma, dados: DadosDoEmail): EmailMontado {
    const t = TEXTOS[idioma]
    const v = {
        numero: dados.numero,
        assunto: dados.assunto,
        nome: dados.nomeDoUsuario,
        app: dados.nomeDoApp,
    }

    const assunto = preencher(
        t[
            momento === 'abertura'
                ? 'assuntoAbertura'
                : momento === 'atualizacao'
                  ? 'assuntoAtualizacao'
                  : 'assuntoEncerramento'
        ] ?? '',
        v
    )

    const chamada = preencher(
        t[
            momento === 'abertura'
                ? 'aberturaCorpo'
                : momento === 'atualizacao'
                  ? 'atualizacaoCorpo'
                  : 'encerramentoCorpo'
        ] ?? '',
        v
    )

    const citacoes = dados.mensagens
        .map((m) => `${m.autor}:\n${m.corpo}`)
        .join('\n\n')

    /**
     * A parte TEXTO vai sempre, e não é cortesia: e-mail só-HTML pesa contra a
     * entrega de um domínio de envio que ainda não tem reputação.
     */
    const texto = [
        preencher(t['ola'] ?? '', v),
        '',
        chamada,
        citacoes === '' ? '' : `\n${citacoes}`,
        '',
        `${t['verChamado']}: ${dados.link}`,
        '',
        preencher(t['naoResponda'] ?? '', v),
        preencher(t['rodape'] ?? '', v),
    ]
        .filter((l) => l !== null)
        .join('\n')

    const blocos = dados.mensagens
        .map(
            (m) =>
                `<div style="border-left:3px solid #d6d9e0;padding:4px 0 4px 12px;margin:12px 0">
                    <strong style="font-size:13px;color:#5b6271">${escapar(m.autor)}</strong>
                    <div style="white-space:pre-wrap">${escapar(m.corpo)}</div>
                 </div>`
        )
        .join('')

    const html = `<!doctype html>
<html lang="${idioma}"><body style="margin:0;background:#f6f7f9;font:15px/1.6 -apple-system,Segoe UI,sans-serif;color:#1b1d22">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px">
    <div style="background:#fff;border:1px solid #e3e6ec;border-radius:10px;padding:22px">
      <p style="margin:0 0 12px">${escapar(preencher(t['ola'] ?? '', v))}</p>
      <p style="margin:0 0 8px">${escapar(chamada)}</p>
      ${blocos}
      <p style="margin:20px 0 0">
        <a href="${escapar(dados.link)}" style="display:inline-block;background:#2b6cb0;color:#fff;text-decoration:none;padding:10px 16px;border-radius:7px;font-weight:600">${escapar(t['verChamado'] ?? '')}</a>
      </p>
    </div>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7280">${escapar(preencher(t['naoResponda'] ?? '', v))}</p>
    <p style="margin:6px 0 0;font-size:12px;color:#6b7280">${escapar(preencher(t['rodape'] ?? '', v))}</p>
  </div>
</body></html>`

    return { assunto, texto, html }
}
