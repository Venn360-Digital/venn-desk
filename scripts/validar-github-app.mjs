/**
 * Valida o GitHub App do Venn Desk a partir da chave no cofre, sem imprimir
 * segredo nenhum.
 *
 *   node scripts/validar-github-app.mjs <APP_ID> <INSTALACAO_ID>
 *
 * Confere quatro coisas, na ordem em que uma falha explicaria a seguinte: o App
 * existe e tem só `contents: read`; a instalação troca o JWT por um token; a
 * instalação alcança SÓ o venn-saas; e um repositório fora da lista responde
 * 404. A chave é lida de `~/.venn360-secrets/venn-desk/github-app.pkcs8.pem`.
 *
 * Validado em 20/11/2026: App 5852623, instalação 184125469, owner
 * Venn360-Digital.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { importPKCS8, SignJWT } from 'jose'

const [appId, instalacaoId] = process.argv.slice(2)
if (!appId || !instalacaoId) { console.error('uso: node scripts/validar-github-app.mjs <APP_ID> <INSTALACAO_ID>'); process.exit(2) }
const pem = readFileSync(join(homedir(), '.venn360-secrets/venn-desk/github-app.pkcs8.pem'), 'utf8')
const chave = await importPKCS8(pem, 'RS256')
const agora = Math.floor(Date.now() / 1000)
const jwt = await new SignJWT({}).setProtectedHeader({ alg: 'RS256' }).setIssuer(appId).setIssuedAt(agora - 60).setExpirationTime(agora + 540).sign(chave)
const h = { Authorization: `Bearer ${jwt}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'venn-desk' }

const app = await fetch('https://api.github.com/app', { headers: h })
const appJson = await app.json().catch(() => ({}))
console.log('GET /app →', app.status, app.ok ? `slug=${appJson.slug} owner=${appJson.owner?.login} permissions=${JSON.stringify(appJson.permissions)}` : JSON.stringify(appJson).slice(0, 200))

const tok = await fetch(`https://api.github.com/app/installations/${instalacaoId}/access_tokens`, { method: 'POST', headers: h })
const tokJson = await tok.json().catch(() => ({}))
console.log('POST access_tokens →', tok.status, tok.ok ? `expira=${tokJson.expires_at} repos=${tokJson.repository_selection} perms=${JSON.stringify(tokJson.permissions)}` : JSON.stringify(tokJson).slice(0, 200))
if (!tok.ok) process.exit(1)

const hi = { Authorization: `Bearer ${tokJson.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'venn-desk' }
const repos = await fetch('https://api.github.com/installation/repositories', { headers: hi }).then(r => r.json())
console.log('repositórios alcançáveis:', (repos.repositories ?? []).map(r => r.full_name).join(', ') || '(nenhum)')
const alvo = (repos.repositories ?? [])[0]?.full_name
if (alvo) {
  const ramo = await fetch(`https://api.github.com/repos/${alvo}/branches/main`, { headers: hi })
  const j = await ramo.json().catch(() => ({}))
  console.log(`GET ${alvo}/branches/main →`, ramo.status, j.commit?.sha?.slice(0, 7) ?? '')
  const outro = await fetch(`https://api.github.com/repos/Venn360-Digital/venn-desk/branches/main`, { headers: hi })
  console.log('GET venn-desk (fora da instalação) →', outro.status, outro.status === 404 ? '(certo: não alcança)' : '(ATENÇÃO: alcança repositório fora da lista)')
}
