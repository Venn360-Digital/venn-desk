import { extrairEmails, type Emails } from './extrair/emails.ts'
import { extrairFaq, type Faq } from './extrair/faq.ts'
import { extrairMenu, type Menu } from './extrair/menu.ts'
import { extrairPapeis, type Papeis } from './extrair/papeis.ts'
import { extrairPlanos, type Planos } from './extrair/planos.ts'
import { extrairProduto, type Produto } from './extrair/produto.ts'
import { extrairVocabulario } from './extrair/vocabulario.ts'
import type { Extrator } from './extrair/com-modelo.ts'
import { renderizarFaq } from './renderizar/faq.ts'
import { CAMINHO_DO_MENU, renderizarMenu } from './renderizar/menu.ts'
import { CAMINHOS_DOS_PLANOS, renderizarPlanos } from './renderizar/planos.ts'
import { CAMINHO_DOS_EMAILS, CHAVE_EMAILS, renderizarEmails } from './renderizar/emails.ts'
import { CAMINHO_DOS_PAPEIS, CHAVE_PAPEIS, renderizarPapeis } from './renderizar/papeis.ts'
import { CAMINHO_DO_PRODUTO, PREFIXO_PRODUTO, renderizarProduto } from './renderizar/produto.ts'
import { ErroDeExtracao, type AppSincronizavel, type ArtigoRenderizado, type ContextoDeRenderizacao, type Extracao } from './tipos.ts'

/**
 * O catálogo das fontes — a ALLOWLIST do que o Desk lê no repositório.
 *
 * Cada fonte diz quais caminhos quer (por app), como extrair deles e como
 * virar artigo. Nada fora desta lista é lido: `docs/` do venn-saas tem a
 * engenharia reversa de um concorrente, e `plataforma/` é console interno —
 * os dois virariam resposta a cliente se um varredor genérico passasse por
 * ali. Um teste prova que nenhum caminho começa com `docs/`.
 *
 * `versaoDoExtrator` sobe quando a forma do artigo muda: a sincronização
 * re-renderiza os artigos cuja versão gravada é menor, sem reler o GitHub.
 *
 * `publicarDireto` é `true` em todas, por decisão do André (19/11/2026): texto
 * que já está em produção no produto não precisa de um segundo revisor para
 * virar artigo. O que protege o cliente é a ancoragem e o esquema estrito, não
 * um clique.
 */

export type TipoDeFonte = 'faq' | 'menu' | 'planos' | 'papeis' | 'emails' | 'produto'

/**
 * O app cujo vocabulário escreveu o `PRODUCT.md`.
 *
 * Não é escolha: o arquivo fala em clínica e paciente porque o Odontobox foi o
 * primeiro produto. A renderização parte daqui para traduzir para os outros
 * dois, e o artigo diz que houve tradução.
 */
export const APP_DO_PRODUCT_MD = 'apps/odontobox360'

export interface Fonte<D = unknown> {
    tipo: TipoDeFonte
    descricao: string
    versaoDoExtrator: number
    /** Prefixo das chaves dos artigos desta fonte. É o que `arquivarDerivadosFora` usa. */
    prefixoDaChave: string
    publicarDireto: boolean
    /** Precisa do modelo? Sem `extrator`, a fonte é pulada e registrada. */
    precisaDeModelo: boolean
    caminhos(app: AppSincronizavel): string[]
    extrair(arquivos: Record<string, string>, extrator: Extrator | null): Promise<Extracao<D>>
    renderizar(dados: D, ctx: ContextoDeRenderizacao, caminhos: string[]): ArtigoRenderizado[]
}

function arquivo(arquivos: Record<string, string>, caminho: string, fonte: string): string {
    const conteudo = arquivos[caminho]
    if (conteudo === undefined) throw new ErroDeExtracao(fonte, `o arquivo ${caminho} não veio do repositório`)
    return conteudo
}

export const FONTE_FAQ: Fonte<Faq> = {
    tipo: 'faq',
    descricao: 'perguntas frequentes do produto',
    versaoDoExtrator: 1,
    prefixoDaChave: 'derivado:faq:',
    publicarDireto: true,
    precisaDeModelo: false,
    caminhos: (app) => [`${app.pastaNoRepositorio}/src/app/(dashboard)/suporte/page.tsx`],
    async extrair(arquivos, _extrator) {
        const [caminho] = Object.keys(arquivos)
        const faq = extrairFaq(arquivo(arquivos, caminho ?? '', 'faq'))
        /// Sem fallback por modelo nesta versão: a forma mudou, a FAQ para e o
        /// Console mostra. Um fallback que adivinhasse perguntas seria pior.
        if (faq === null) throw new ErroDeExtracao('faq', `a FAQ em ${caminho} não tem a forma esperada (const FAQ = [{ grupo, itens: [{ p, r }] }])`)
        return { dados: faq, extraidoPor: 'parser' }
    },
    renderizar: (faq, ctx, caminhos) => renderizarFaq(faq, ctx, caminhos[0] ?? ''),
}

export const FONTE_MENU: Fonte<Menu> = {
    tipo: 'menu',
    descricao: 'menu do produto',
    versaoDoExtrator: 1,
    prefixoDaChave: 'derivado:menu',
    publicarDireto: true,
    precisaDeModelo: true,
    caminhos: () => [CAMINHO_DO_MENU],
    async extrair(arquivos, extrator) {
        if (extrator === null) throw new ErroDeExtracao('menu', 'esta fonte precisa do modelo e não há chave')
        return extrairMenu(arquivo(arquivos, CAMINHO_DO_MENU, 'menu'), extrator)
    },
    renderizar: (menu, ctx) => renderizarMenu(menu, ctx),
}

export const FONTE_PLANOS: Fonte<Planos> = {
    tipo: 'planos',
    descricao: 'tabela de planos do produto',
    versaoDoExtrator: 1,
    prefixoDaChave: 'derivado:planos',
    publicarDireto: true,
    precisaDeModelo: true,
    caminhos: () => CAMINHOS_DOS_PLANOS,
    async extrair(arquivos, extrator) {
        if (extrator === null) throw new ErroDeExtracao('planos', 'esta fonte precisa do modelo e não há chave')
        return extrairPlanos(
            {
                planLimitsTs: arquivo(arquivos, CAMINHOS_DOS_PLANOS[0] ?? '', 'planos'),
                plansTs: arquivo(arquivos, CAMINHOS_DOS_PLANOS[1] ?? '', 'planos'),
            },
            extrator
        )
    },
    renderizar: (planos, ctx) => renderizarPlanos(planos, ctx),
}

export const FONTE_PAPEIS: Fonte<Papeis> = {
    tipo: 'papeis',
    descricao: 'as permissões por papel do produto',
    versaoDoExtrator: 1,
    prefixoDaChave: CHAVE_PAPEIS,
    publicarDireto: true,
    precisaDeModelo: true,
    caminhos: () => [CAMINHO_DOS_PAPEIS],
    async extrair(arquivos, extrator) {
        if (extrator === null) throw new ErroDeExtracao('papeis', 'esta fonte precisa do modelo e não há chave')
        return extrairPapeis(arquivo(arquivos, CAMINHO_DOS_PAPEIS, 'papeis'), extrator)
    },
    renderizar: (papeis, ctx) => renderizarPapeis(papeis, ctx),
}

export const FONTE_EMAILS: Fonte<Emails> = {
    tipo: 'emails',
    descricao: 'os e-mails automáticos do produto',
    versaoDoExtrator: 1,
    prefixoDaChave: CHAVE_EMAILS,
    publicarDireto: true,
    precisaDeModelo: true,
    caminhos: () => [CAMINHO_DOS_EMAILS],
    async extrair(arquivos, extrator) {
        if (extrator === null) throw new ErroDeExtracao('emails', 'esta fonte precisa do modelo e não há chave')
        return extrairEmails(arquivo(arquivos, CAMINHO_DOS_EMAILS, 'emails'), extrator)
    },
    renderizar: (emails, ctx) => renderizarEmails(emails, ctx),
}

export const FONTE_PRODUTO: Fonte<Produto> = {
    tipo: 'produto',
    descricao: 'as regras de produto da Venn360',
    versaoDoExtrator: 1,
    prefixoDaChave: PREFIXO_PRODUTO,
    publicarDireto: true,
    precisaDeModelo: false,
    /// O segundo caminho é o vocabulário EM QUE o arquivo foi escrito, não o do
    /// app corrente: é dele que a tradução parte.
    caminhos: () => [CAMINHO_DO_PRODUTO, `${APP_DO_PRODUCT_MD}/src/config/brand.ts`],
    async extrair(arquivos, _extrator) {
        const markdown = arquivo(arquivos, CAMINHO_DO_PRODUTO, 'produto')
        const brand = arquivo(arquivos, `${APP_DO_PRODUCT_MD}/src/config/brand.ts`, 'produto')
        return {
            dados: {
                secoes: extrairProduto(markdown),
                vocabularioDaFonte: extrairVocabulario(brand),
                appDaFonte: APP_DO_PRODUCT_MD,
            },
            extraidoPor: 'parser',
        }
    },
    renderizar: (produto, ctx) => renderizarProduto(produto, ctx),
}

/**
 * Na ordem em que sincronizam: as determinísticas primeiro.
 *
 * Importa porque o teto da rodada corta as que precisam do modelo, e uma fonte
 * barata nunca deve ficar de fora por causa de uma cara.
 */
export const FONTES: Fonte[] = [
    FONTE_FAQ as Fonte,
    FONTE_PRODUTO as Fonte,
    FONTE_MENU as Fonte,
    FONTE_PLANOS as Fonte,
    FONTE_PAPEIS as Fonte,
    FONTE_EMAILS as Fonte,
]

/** O caminho do vocabulário de um app. Não é fonte de artigo: alimenta as outras. */
export function caminhoDoVocabulario(app: AppSincronizavel): string {
    return `${app.pastaNoRepositorio}/src/config/brand.ts`
}
