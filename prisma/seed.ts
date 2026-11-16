import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { exportJWK, generateKeyPair } from 'jose'

import { criarCliente, descartarCliente } from '../src/dados/cliente.ts'
import { hashDeSenha } from '../src/auth/sessao-console.ts'

/**
 * Semente dos três apps — o cadastro mínimo para o Venn Desk atender.
 *
 * O que ela NÃO faz, de propósito: criar tenant e solicitante. Esses nascem
 * das claims do token a cada requisição (ADR 0003), e semeá-los daria a
 * impressão de que o Desk conhece os usuários por fora do app.
 *
 * As chaves: cada app assina o token do usuário com a sua chave privada, que
 * mora no segredo do Worker DAQUELE app. Aqui a semente gera um par por app e
 * guarda a METADE PRIVADA em `.dev/chaves/`, fora do git — é o que permite aos
 * testes de integração forjar um token válido. A metade pública vai para o
 * banco. Em produção a pública é cadastrada à mão, a partir da chave que o app
 * já tem; passe `--sem-chaves` para não gerar nada e deixar o campo pendente.
 *
 * Nada de valor secreto é impresso: só impressão digital.
 */

const APPS = [
    { slug: 'odontobox', nome: 'Odontobox360', prefixo: 'ODB' },
    { slug: 'conecta', nome: 'Conecta360', prefixo: 'CNT' },
    { slug: 'stagent', nome: 'Stagent360', prefixo: 'STG' },
] as const

const PASTA_DE_CHAVES = join(process.cwd(), '.dev', 'chaves')

async function digital(valor: string): Promise<string> {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(valor))
    return [...new Uint8Array(bytes)]
        .slice(0, 4)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

async function parDeChaves(slug: string) {
    const { privateKey, publicKey } = await generateKeyPair('Ed25519', { extractable: true })
    const privada = await exportJWK(privateKey)
    const publica = await exportJWK(publicKey)

    const caminho = join(PASTA_DE_CHAVES, `${slug}.privada.jwk.json`)
    mkdirSync(dirname(caminho), { recursive: true })
    writeFileSync(caminho, `${JSON.stringify(privada, null, 2)}\n`, { mode: 0o600 })

    return { publica, caminho }
}

async function main() {
    const semChaves = process.argv.includes('--sem-chaves')
    const soPlano = process.argv.includes('--plano')

    if (soPlano) {
        console.log('Plano da semente (nada é gravado):')
        for (const app of APPS) {
            console.log(`  app   ${app.slug.padEnd(12)} ${app.prefixo}  ${app.nome}`)
        }
        console.log('  agente admin@venn360.com (papel ADMIN, senha de CONSOLE_SENHA_INICIAL)')
        console.log(semChaves ? '  sem gerar chaves' : `  um par Ed25519 por app em ${PASTA_DE_CHAVES}`)
        return
    }

    const senha = process.env.CONSOLE_SENHA_INICIAL
    if (!senha || senha.length < 12) {
        throw new Error(
            'CONSOLE_SENHA_INICIAL ausente ou curta demais (mínimo 12). ' +
                'É a senha do primeiro agente do Console; defina-a no ambiente, nunca no código.'
        )
    }

    const cliente = criarCliente(process.env.DATABASE_URL ?? '')

    try {
        for (const app of APPS) {
            const chave = semChaves ? null : await parDeChaves(app.slug)

            /**
             * `upsert` e não `create`: a semente roda mais de uma vez — no banco
             * novo, depois de um reset, e no staging a cada vez que alguém
             * quiser conferir o cadastro. Ela não pode derrubar o que existe.
             *
             * O `proximoNumero` fica FORA do update: sobrescrevê-lo reiniciaria
             * a numeração de chamados de um app que já atende.
             */
            const gravado = await cliente.app.upsert({
                where: { slug: app.slug },
                create: {
                    slug: app.slug,
                    nome: app.nome,
                    prefixo: app.prefixo,
                    chavePublicaJwk: chave?.publica ?? {},
                    modoSombra: true,
                },
                update: {
                    nome: app.nome,
                    prefixo: app.prefixo,
                    ...(chave === null ? {} : { chavePublicaJwk: chave.publica }),
                },
            })

            const impressao = chave === null ? 'mantida' : await digital(JSON.stringify(chave.publica))
            console.log(
                `  ✓ ${app.slug.padEnd(12)} ${gravado.prefixo}  modo sombra ligado  chave pública ${impressao}`
            )
            if (chave !== null) console.log(`    privada em ${chave.caminho.replace(process.cwd(), '.')}`)
        }

        const agente = await cliente.agent.upsert({
            where: { email: 'admin@venn360.com' },
            create: {
                nome: 'André',
                email: 'admin@venn360.com',
                papel: 'ADMIN',
                tipo: 'HUMANO',
                senhaHash: await hashDeSenha(senha),
            },
            update: { papel: 'ADMIN', senhaHash: await hashDeSenha(senha) },
        })

        console.log(`  ✓ agente ${agente.email} (${agente.papel})`)
        console.log('\nSemente aplicada. Nenhum valor secreto foi impresso.')
    } finally {
        await descartarCliente(cliente)
    }
}

main().catch((erro) => {
    console.error('ABORTA:', erro instanceof Error ? erro.message : erro)
    process.exit(1)
})
