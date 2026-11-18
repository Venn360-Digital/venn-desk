import { importJWK, jwtVerify, type JWK, type JWTPayload } from 'jose'
import { z } from 'zod'

import { ErroDeToken } from '../lib/erros.ts'

/**
 * A validação do token que o app assina — ADR 0003.
 *
 * É o único jeito de um chamado nascer: sem token válido não há chamado, e é
 * assim que "apenas usuários logados" é garantido sem o Venn Desk ler o banco de
 * app nenhum e sem o app mandar cookie de sessão para cá.
 *
 * O que esta função recusa, e por quê cada um importa:
 *
 *  - **assinatura de outra chave** — é a trava de isolamento entre apps na
 *    camada de entrada: um token do Odontobox apresentado como se fosse do
 *    Conecta morre aqui, antes de qualquer consulta;
 *  - **validade longa** — o desenho diz 10 minutos. Um app que emitisse token de
 *    30 dias transformaria vazamento de token em acesso permanente, e o Desk não
 *    tem como revogar o que outro sistema assinou. Então o teto é verificado
 *    aqui, não confiado ao emissor;
 *  - **público errado** — `aud` fixo impede que um token emitido para outro fim
 *    dentro do app seja reapresentado ao Desk;
 *  - **claim `app` divergente** — a chave já diz de quem é o token, mas a claim
 *    é conferida também: se um dia a mesma chave servir a dois cadastros por
 *    engano, a divergência aparece como recusa, não como chamado no app errado.
 */

export const PUBLICO = 'venn-desk'

/** O teto de validade do token, em segundos (ADR 0003: 10 minutos). */
export const VALIDADE_MAXIMA_S = 600

/**
 * Tolerância de relógio. Pequena de propósito: cinco segundos cobrem a deriva
 * entre dois Workers, e nada além disso.
 */
const TOLERANCIA_S = 5

const esquemaDasClaims = z.object({
    app: z.string().min(1),
    tenant_id: z.string().min(1),
    /**
     * O NOME da empresa/workspace. Opcional pela mesma razão das claims de
     * conta — mas sem ele a fila mostra o id no lugar do nome, que é o que
     * acontecia antes desta claim existir.
     */
    tenant_nome: z.string().min(1).optional(),
    user_id: z.string().min(1),
    nome: z.string().min(1),
    email: z.string().email(),
    papel: z.string().min(1).default('member'),
    plano: z.string().min(1).optional(),
    /**
     * A conta acima da empresa, quando o app a informa (`Account → Workspace`
     * nos apps). OPCIONAIS: o app que ainda não as manda continua funcionando,
     * e o chamado fica sem conta até ele mandar. Exigi-las travaria o Venn
     * Desk na instalação do widget nos três apps.
     */
    account_id: z.string().min(1).optional(),
    account_nome: z.string().min(1).optional(),
})

export interface IdentidadeDoSolicitante {
    appSlug: string
    tenantExternalId: string
    tenantNome?: string
    requesterExternalId: string
    nome: string
    email: string
    papelNoTenant: string
    plano?: string
    contaExternalId?: string
    contaNome?: string
}

export interface AppParaValidacao {
    slug: string
    chavePublicaJwk: JWK
}

/** Os únicos algoritmos que o Venn Desk aceita (ADR 0003). */
const ALGORITMOS = ['Ed25519', 'EdDSA'] as const

/**
 * O algoritmo da chave cadastrada — e por que ele não é confiado ao cadastro.
 *
 * `importJWK` exige `alg` quando o JWK não o traz, e um JWK exportado por
 * `exportJWK` não traz. Em vez de pedir o campo no cadastro, ele é DERIVADO da
 * curva: assim um cadastro feito pela forma mais curta continua funcionando.
 *
 * E a derivação é também a trava: só curva Ed25519 passa. Uma chave RSA ou EC
 * cadastrada por engano é recusada aqui, e não aceita como um algoritmo mais
 * fraco que o desenho não previu.
 */
function algoritmoDaChave(jwk: JWK): string {
    if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
        throw new ErroDeToken('chave_invalida', 'A configuração do app está incompleta.')
    }

    const declarado = jwk.alg
    return typeof declarado === 'string' && (ALGORITMOS as readonly string[]).includes(declarado)
        ? declarado
        : 'Ed25519'
}

export async function validarTokenDoApp(
    token: string,
    app: AppParaValidacao
): Promise<IdentidadeDoSolicitante> {
    const algoritmo = algoritmoDaChave(app.chavePublicaJwk)

    const chave = await importJWK(app.chavePublicaJwk, algoritmo).catch(() => {
        /// Chave mal cadastrada é erro nosso, não do portador do token — mas a
        /// resposta ao cliente não diz mais que isto.
        throw new ErroDeToken('chave_invalida', 'A configuração do app está incompleta.')
    })

    let payload: JWTPayload
    try {
        const verificado = await jwtVerify(token, chave, {
            algorithms: [...ALGORITMOS],
            audience: PUBLICO,
            clockTolerance: TOLERANCIA_S,
            requiredClaims: ['exp', 'iat'],
        })
        payload = verificado.payload
    } catch {
        throw new ErroDeToken('token_invalido', 'Sessão expirada. Recarregue a página.')
    }

    const { iat, exp } = payload
    if (typeof iat !== 'number' || typeof exp !== 'number') {
        throw new ErroDeToken('token_invalido', 'Sessão expirada. Recarregue a página.')
    }

    if (exp - iat > VALIDADE_MAXIMA_S) {
        throw new ErroDeToken(
            'token_longo',
            'O token do app vale por mais tempo do que o permitido.'
        )
    }

    const claims = esquemaDasClaims.safeParse(payload)
    if (!claims.success) {
        throw new ErroDeToken('claims_incompletas', 'A sessão não identifica o usuário.')
    }

    if (claims.data.app !== app.slug) {
        throw new ErroDeToken('app_divergente', 'Este token não pertence a este app.')
    }

    return {
        appSlug: claims.data.app,
        tenantExternalId: claims.data.tenant_id,
        ...(claims.data.tenant_nome === undefined
            ? {}
            : { tenantNome: claims.data.tenant_nome }),
        requesterExternalId: claims.data.user_id,
        nome: claims.data.nome,
        email: claims.data.email,
        papelNoTenant: claims.data.papel,
        ...(claims.data.plano === undefined ? {} : { plano: claims.data.plano }),
        ...(claims.data.account_id === undefined
            ? {}
            : { contaExternalId: claims.data.account_id }),
        ...(claims.data.account_nome === undefined
            ? {}
            : { contaNome: claims.data.account_nome }),
    }
}

/** O administrador do tenant vê os chamados da empresa; os outros, só os seus. */
export function veOsChamadosDaEmpresa(identidade: IdentidadeDoSolicitante): boolean {
    return identidade.papelNoTenant === 'admin' || identidade.papelNoTenant === 'owner'
}
