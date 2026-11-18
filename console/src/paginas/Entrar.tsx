import { useState } from 'react'

import { api } from '../api.ts'
import { Aviso, Botao, Campo } from '../componentes/ui.tsx'
import { Marca } from '../componentes/Shell.tsx'

/**
 * A entrada no Console. Sessão própria, separada dos apps (seção 10).
 *
 * A marca aparece aqui porque é a única tela do Console que alguém vê sem já
 * saber onde está — e porque é a primeira impressão do produto para quem for
 * contratado para atender.
 *
 * **Sóbria de propósito.** O estudo visual da marca pede predominância
 * monocromática e cor pontual; uma tela de login com fundo colorido ou com o
 * gradiente das frentes gastaria o recurso mais escasso da identidade no lugar
 * onde ele menos trabalha.
 */
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
            /**
             * A mensagem vem do servidor, e agora vem mesmo.
             *
             * O `api()` trocava qualquer 401 por "sessão encerrada", então esta
             * tela dizia à pessoa para entrar de novo exatamente com o que
             * acabou de não funcionar, em vez de "e-mail ou senha incorretos".
             * Ver o cabeçalho de `api.ts`.
             *
             * O texto do servidor é o MESMO para e-mail inexistente e senha
             * errada — não dizemos quais e-mails existem.
             */
            setErro(falha instanceof Error ? falha.message : 'Não foi possível entrar.')
        } finally {
            setEnviando(false)
        }
    }

    return (
        <main className="grid min-h-screen place-items-center bg-superficie-2 px-4">
            <div className="w-full max-w-sm">
                <div className="mb-7 flex flex-col items-center gap-3">
                    <img
                        src="/logomarca/emblema.png"
                        alt=""
                        aria-hidden
                        width={256}
                        height={191}
                        className="h-14 w-auto"
                    />
                    <Marca />
                </div>

                <form
                    onSubmit={enviar}
                    className="space-y-4 rounded-md border border-borda bg-superficie p-6 shadow-marca-sm"
                >
                    <header>
                        <h1 className="text-sm font-semibold">Venn Desk</h1>
                        <p className="text-xs text-tinta-fraca">
                            Central de suporte dos produtos Venn360
                        </p>
                    </header>

                    <Campo
                        rotulo="E-mail"
                        valor={email}
                        onChange={setEmail}
                        tipo="email"
                        requerido
                    />
                    <Campo
                        rotulo="Senha"
                        valor={senha}
                        onChange={setSenha}
                        tipo="password"
                        requerido
                    />

                    {erro !== null && <Aviso>{erro}</Aviso>}

                    <Botao tipo="submit" desabilitado={enviando || email === '' || senha === ''}>
                        {enviando ? 'Entrando…' : 'Entrar'}
                    </Botao>
                </form>

                <p className="mt-5 text-center text-[11px] text-tinta-sutil">
                    É cliente e seu aplicativo está fora do ar?{' '}
                    <a
                        href="https://venn360-digital.github.io/venn-desk/"
                        className="underline transition hover:text-tinta-fraca"
                    >
                        veja o status dos sistemas
                    </a>
                </p>
            </div>
        </main>
    )
}
