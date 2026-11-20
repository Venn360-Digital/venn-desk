/**
 * Pede uma sincronização da base viva pelo Console, como o botão "Sincronizar
 * agora" — para testar sem esperar o cron.
 *
 *   AMBIENTE=stg node scripts/sincronizar-base.mjs conecta
 *   node scripts/sincronizar-base.mjs odontobox        # produção
 *   node scripts/sincronizar-base.mjs --estado conecta  # só mostra o estado
 *
 * A senha do Console sai do cofre e não é impressa.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const AMBIENTE = process.env.AMBIENTE ?? 'production'
const BASES = { production: 'https://desk.venn360.com', stg: 'https://venn-desk.andre-7ee.workers.dev' }
const BASE = BASES[AMBIENTE]
if (BASE === undefined) { console.error('AMBIENTE deve ser production ou stg'); process.exit(2) }

const args = process.argv.slice(2)
const SO_ESTADO = args.includes('--estado')
const app = args.find((a) => !a.startsWith('--'))
if (!app) { console.error('informe o slug do app'); process.exit(2) }

function senhaDoConsole() {
    const arquivo = join(homedir(), '.venn360-secrets/venn-desk', `worker-${AMBIENTE}.env`)
    const linha = readFileSync(arquivo, 'utf8').split('\n').find((l) => l.startsWith('export CONSOLE_SENHA_INICIAL='))
    if (linha === undefined) throw new Error(`CONSOLE_SENHA_INICIAL não está em ${arquivo}`)
    return linha.slice('export CONSOLE_SENHA_INICIAL='.length).trim().replace(/^['"]|['"]$/g, '')
}

const login = await fetch(`${BASE}/api/console/sessao`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@venn360.com', senha: senhaDoConsole() }),
})
const sessao = /venn_desk_sessao=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')?.[1]
if (!login.ok || !sessao) { console.error('login falhou:', login.status); process.exit(1) }
const h = { Authorization: `Bearer ${sessao}`, 'Content-Type': 'application/json' }

if (!SO_ESTADO) {
    const r = await fetch(`${BASE}/api/console/app/${app}/base-sincronizacao`, { method: 'POST', headers: h })
    console.log('POST →', r.status, JSON.stringify(await r.json()))
}
const e = await fetch(`${BASE}/api/console/app/${app}/base-sincronizacao`, { headers: h }).then((r) => r.json())
const { historico: _h, ...resto } = e
console.log(JSON.stringify({ ...resto, ultima: resto.ultima && { ...resto.ultima, resultado: resto.ultima.resultado && { fontes: Object.fromEntries(Object.entries(resto.ultima.resultado.fontes ?? {}).map(([k, v]) => [k, v.estado])), mapa: resto.ultima.resultado.mapa, custo: resto.ultima.resultado.custoEstimadoUsd, avisos: resto.ultima.resultado.avisos } } }, null, 1))
