import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

/**
 * O Console é uma SPA servida pelo próprio Worker em produção (ADR 0008), e em
 * desenvolvimento roda aqui com proxy para o Worker de homologação.
 *
 * **O proxy existe porque o Worker não roda nesta máquina.** O macOS 12.6 não
 * suporta o workerd, então `wrangler dev` não sobe — mas o Vite sobe, e é por
 * isso que o Console é Vite e não Next. O proxy manda `/api` e `/arquivos`
 * para o Worker publicado, então a tela trabalha com dado real.
 *
 * Troque `VENN_DESK_API` para apontar para outro ambiente.
 */
const API = process.env.VENN_DESK_API ?? 'https://venn-desk.andre-7ee.workers.dev'

export default defineConfig({
    /// A raiz é esta pasta, não o diretório de onde o comando foi chamado: o
    /// script roda da raiz do repositório, onde não existe index.html.
    root: fileURLToPath(new URL('.', import.meta.url)),
    plugins: [react(), tailwind()],
    server: {
        port: 5273,
        proxy: {
            '/api': { target: API, changeOrigin: true, secure: true },
            '/arquivos': { target: API, changeOrigin: true, secure: true },
        },
    },
    build: { outDir: 'dist', emptyOutDir: true },
})
