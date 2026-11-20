import { rodape } from '../rotulos.ts'
import type { ArtigoRenderizado, ContextoDeRenderizacao } from '../tipos.ts'
import type { Emails } from '../extrair/emails.ts'
import { resolverPlaceholders } from './vocabulario.ts'

export const CHAVE_EMAILS = 'derivado:emails'
export const CAMINHO_DOS_EMAILS = 'packages/core/src/lib/email/billing.ts'

/**
 * "Os e-mails que o sistema envia" — um artigo com o catálogo.
 *
 * Um só, e não um por e-mail: a pergunta chega com o assunto na mão ("recebi
 * 'Cobrança vencida'"), e a busca precisa cair aqui para qualquer um dos dez.
 * As tags levam os assuntos.
 */
export function renderizarEmails(emails: Emails, ctx: ContextoDeRenderizacao): ArtigoRenderizado[] {
    const r = (t: string) => resolverPlaceholders(t, ctx.vocabulario).replace(/\{\{marca\}\}/g, ctx.app.nome)

    return [
        {
            chave: CHAVE_EMAILS,
            titulo: `E-mails que o ${ctx.app.nome} envia`,
            corpo: [
                'O que o sistema manda por e-mail, e o que provoca cada um. Serve para explicar a quem recebeu um aviso e não sabe por quê.',
                '',
                ...emails.emails.map((e) => `## ${r(e.assunto)}\n**${r(e.titulo)}** — ${r(e.quando)}`),
                '',
                rodape({ descricao: 'os e-mails automáticos do produto', caminhos: [CAMINHO_DOS_EMAILS], commit: ctx.commit }),
            ].join('\n'),
            tags: ['e-mail', 'aviso', 'notificação', ...emails.emails.slice(0, 12).map((e) => r(e.titulo).toLowerCase())].slice(0, 20),
            dados: emails,
            caminhos: [CAMINHO_DOS_EMAILS],
        },
    ]
}
