import { useState } from 'react'

import { api } from '../api.ts'
import { Aviso, Botao, Campo } from '../componentes/ui.tsx'

/** Login do Console. Sessão própria, separada dos apps (seção 10). */
export function Entrar({ aoEntrar }: { aoEntrar: () => void }) {
    const [email, setEmail] = useState('')
    const [senha, setSenha] = useState('')
    const [erro, setErro] = useState<string | null>(null)
    const [enviando, setEnviando] = useState(false)

    async function enviar(e: React.FormEvent) {
        e.preventDefault()
        setErro(null)
        setEnviando(true)
        try {
            await api('/sessao', { metodo: 'POST', corpo: { email, senha } })
            aoEntrar()
        } catch (falha) {
            /// A mensagem vem do servidor e é deliberadamente igual para e-mail
            /// inexistente e senha errada — não dizemos quais e-mails existem.
            setErro(falha instanceof Error ? falha.message : 'Não foi possível entrar.')
        } finally {
            setEnviando(false)
        }
    }

    return (
        <main className="grid min-h-screen place-items-center px-4">
            <form onSubmit={enviar} className="w-full max-w-sm space-y-4">
                <header className="mb-6">
                    <h1 className="text-lg font-semibold">Venn Desk</h1>
                    <p className="text-sm text-tinta-fraca">Console de atendimento</p>
                </header>

                <Campo rotulo="E-mail" valor={email} onChange={setEmail} tipo="email" requerido />
                <Campo rotulo="Senha" valor={senha} onChange={setSenha} tipo="password" requerido />

                {erro !== null && <Aviso>{erro}</Aviso>}

                <Botao tipo="submit" desabilitado={enviando || email === '' || senha === ''}>
                    {enviando ? 'Entrando…' : 'Entrar'}
                </Botao>
            </form>
        </main>
    )
}
