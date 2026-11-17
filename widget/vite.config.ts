import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { importJWK, SignJWT } from 'jose'

const API = process.env.VENN_DESK_API ?? 'https://venn-desk.andre-7ee.workers.dev'
const APP = process.env.VENN_DESK_APP ?? 'odontobox'

/**
 * O middleware que faz o papel do backend do app na demonstração: assina o
 * token com a chave de desenvolvimento que a semente gerou.
 *
 * Em produção esse papel é da rota do app, usando `criarRotaDeToken` de
 * `@venn/desk-widget/servidor` — a mesma assinatura, a mesma validade, com a
 * chave vindo do segredo do Worker daquele app.
 *
 * Só roda em `vite dev`. A demonstração não é publicada.
 */
function rotaDeTokenDeDesenvolvimento(): Plugin {
    return {
        name: 'venn-desk-token-dev',
        apply: 'serve',
        configureServer(servidor) {
            servidor.middlewares.use('/api/venn-desk/token', (req, res) => {
                void (async () => {
                    if (req.method !== 'POST') {
                        res.statusCode = 405
                        res.end('{"erro":"Use POST."}')
                        return
                    }

                    try {
                        const caminho = fileURLToPath(
                            new URL(`../.dev/chaves/${APP}.privada.jwk.json`, import.meta.url)
                        )
                        const jwk = JSON.parse(readFileSync(caminho, 'utf8'))
                        const agora = Math.floor(Date.now() / 1000)

                        const token = await new SignJWT({
                            app: APP,
                            tenant_id: 'clinica-demo',
                            user_id: 'usuario-demo',
                            nome: 'Ana da Demonstração',
                            email: 'ana@clinicademo.com.br',
                            papel: 'admin',
                            plano: 'pro',
                        })
                            .setProtectedHeader({ alg: 'Ed25519' })
                            .setAudience('venn-desk')
                            .setIssuedAt(agora)
                            .setExpirationTime(agora + 600)
                            .sign(await importJWK(jwk, 'Ed25519'))

                        res.setHeader('Content-Type', 'application/json')
                        res.setHeader('Cache-Control', 'no-store, private')
                        res.end(JSON.stringify({ token, expiraEm: (agora + 600) * 1000 }))
                    } catch (erro) {
                        res.statusCode = 500
                        res.end(
                            JSON.stringify({
                                erro: `Sem chave de desenvolvimento para "${APP}". Rode a semente: pnpm run semear`,
                                detalhe: erro instanceof Error ? erro.message : String(erro),
                            })
                        )
                    }
                })()
            })
        },
    }
}

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react(), rotaDeTokenDeDesenvolvimento()],
    server: {
        port: 5274,
        proxy: {
            /// `/api/app` e `/arquivos` vão para o Worker; `/api/venn-desk` fica
            /// com o middleware acima, que imita o backend do app.
            '/api/app': { target: API, changeOrigin: true, secure: true },
            '/arquivos': { target: API, changeOrigin: true, secure: true },
        },
    },
})
