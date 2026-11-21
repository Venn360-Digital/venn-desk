/**
 * O relatório de divergências entre os apps, sem chamar modelo.
 *
 * Compara os artigos derivados dos três apps depois de dobrar o vocabulário de
 * cada marca. O que sobra é conteúdo que devia ser igual e não é — a FAQ
 * triplicada à mão, texto de um nicho dentro de outro, artigo que falta num app.
 *
 * Uso: DATABASE_URL=… node scripts/divergencias.mjs [--chaves]
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { criarCliente, descartarCliente } from '../src/dados/cliente.ts'
import { levantarDivergencias } from '../src/conhecimento/comparar-apps.ts'
import { chavesQueDivergem } from '../src/conhecimento/divergencias.ts'
import { extrairVocabulario } from '../src/conhecimento/extrair/vocabulario.ts'
import { credencialDoApp } from '../src/conhecimento/github-app.ts'
import { leitorGitHub } from '../src/conhecimento/github.ts'

const banco = process.env.DATABASE_URL
if (banco === undefined || banco === '') {
    console.error('defina DATABASE_URL')
    process.exit(1)
}

/**
 * O vocabulário das rodadas antigas não está no banco (passou a ser gravado em
 * 21/11/2026), então aqui ele é lido do repositório. É de graça: o GitHub não
 * cobra, e nenhum modelo é chamado em nenhuma parte deste relatório.
 */
const doCofre = (arquivo, nome) => {
    const caminho = join(homedir(), '.venn360-secrets/venn-desk', arquivo)
    const linha = readFileSync(caminho, 'utf8').split('\n').find((l) => l.startsWith(`export ${nome}=`))
    return linha?.slice(`export ${nome}=`.length).trim().replace(/^['"]|['"]$/g, '')
}

let lerDoRepositorio
try {
    const credencial = credencialDoApp({
        appId: process.env.GITHUB_APP_ID ?? doCofre('github-app.env', 'GITHUB_APP_ID') ?? '',
        instalacaoId: process.env.GITHUB_APP_INSTALACAO_ID ?? doCofre('github-app.env', 'GITHUB_APP_INSTALACAO_ID') ?? '',
        chavePrivada: readFileSync(join(homedir(), '.venn360-secrets/venn-desk/github-app.pkcs8.pem'), 'utf8'),
    })
    const leitor = leitorGitHub(credencial)
    lerDoRepositorio = async (app) => {
        try {
            const sha = await leitor.shaDoRamo(app.repositorio, 'main')
            const arvore = await leitor.arvore(app.repositorio, sha)
            const entrada = arvore.get(`${app.pastaNoRepositorio}/src/config/brand.ts`)
            if (entrada === undefined) return null
            return extrairVocabulario(await leitor.blob(app.repositorio, entrada.sha))
        } catch (erro) {
            console.error(`  (sem vocabulário de ${app.slug} pelo repositório: ${erro.message})`)
            return null
        }
    }
} catch (erro) {
    console.error(`(GitHub App indisponível, usando só o banco: ${erro.message})`)
}

const cliente = criarCliente(banco)
try {
    const { apps, achados } = await levantarDivergencias(cliente, lerDoRepositorio)

    if (process.argv.includes('--chaves')) {
        console.log(chavesQueDivergem(achados).join('\n'))
    } else {
        console.log(`Apps comparados: ${apps.join(', ')} (referência: ${apps[0] ?? '—'})`)
        console.log(`${achados.length} divergência(s)\n`)

        for (const tipo of ['palavra-de-outro-nicho', 'ausente', 'conteudo']) {
            const doTipo = achados.filter((d) => d.tipo === tipo)
            if (doTipo.length === 0) continue
            console.log(`## ${tipo} (${doTipo.length})`)
            for (const d of doTipo) {
                console.log(`  ${d.app.padEnd(10)} ${d.chave}`)
                console.log(`             ${d.detalhe}`)
            }
            console.log()
        }
    }
} finally {
    await descartarCliente(cliente)
}
