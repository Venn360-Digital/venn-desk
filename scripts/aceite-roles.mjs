/**
 * Prova, conectando de verdade, que a role da aplicação lê e escreve dado mas
 * não faz DDL — o aceite do runbook 19 do venn-saas, aplicado aqui.
 *
 * Uso:
 *   set -a; . ~/.venn360-secrets/venn-desk/neon-staging.env; set +a
 *   node scripts/aceite-roles.mjs
 *
 * Lê `DATABASE_URL_APP` e `DATABASE_URL_MIGRATOR` do ambiente e NUNCA imprime
 * credencial. Cada negativo roda em transação com ROLLBACK: se um deles passar
 * quando não devia, nada fica no banco.
 */
import pg from 'pg'

const APP = process.env.DATABASE_URL_APP
const MIGRADOR = process.env.DATABASE_URL_MIGRATOR

if (!APP || !MIGRADOR) {
    console.error('ABORTA: exporte DATABASE_URL_APP e DATABASE_URL_MIGRATOR (do cofre).')
    process.exit(2)
}

let falhas = 0

async function comCliente(url, fn) {
    const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15000 })
    await c.connect()
    try {
        return await fn(c)
    } finally {
        await c.end()
    }
}

async function deveFalhar(c, rotulo, sql) {
    await c.query('BEGIN')
    try {
        await c.query(sql)
        await c.query('ROLLBACK')
        falhas += 1
        console.log(`  ✗ ${rotulo}: PASSOU QUANDO NÃO DEVIA (revertido)`)
    } catch (e) {
        await c.query('ROLLBACK').catch(() => {})
        console.log(`  ✓ ${rotulo}: recusado — ${e.code}`)
    }
}

async function main() {
    console.log('— role da aplicação —')
    await comCliente(APP, async (c) => {
        const quem = await c.query('SELECT current_user AS u')
        console.log(`  conectado como ${quem.rows[0].u}`)

        const leitura = await c.query(
            'SELECT (SELECT count(*) FROM apps) AS apps, (SELECT count(*) FROM agents) AS agentes, (SELECT count(*) FROM tickets) AS chamados'
        )
        const r = leitura.rows[0]
        console.log(`  ✓ leitura: ${r.apps} apps, ${r.agentes} agentes, ${r.chamados} chamados`)

        /// Escrita de verdade, e desfeita: o app precisa poder gravar chamado.
        await c.query('BEGIN')
        try {
            await c.query(
                "INSERT INTO tenants (id, app_id, external_id, nome) SELECT 'prova', id, 'prova', 'Prova' FROM apps WHERE slug = 'odontobox'"
            )
            console.log('  ✓ INSERT em tenants: permitido')
        } catch (e) {
            falhas += 1
            console.log(`  ✗ INSERT em tenants NEGADO: ${e.code} — o app precisa gravar`)
        }
        await c.query('ROLLBACK')

        await deveFalhar(c, 'CREATE TABLE', 'CREATE TABLE _prova_ddl (id int)')
        await deveFalhar(c, 'DROP TABLE', 'DROP TABLE tickets')
        await deveFalhar(c, 'ALTER TABLE', 'ALTER TABLE tickets ADD COLUMN _x int')
        await deveFalhar(c, 'TRUNCATE', 'TRUNCATE ticket_events')
    })

    console.log('\n— role de migração —')
    await comCliente(MIGRADOR, async (c) => {
        const q = await c.query(
            "SELECT current_user AS u, has_schema_privilege(current_user,'public','CREATE') AS cria, (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner=current_user) AS tabelas_proprias"
        )
        const r = q.rows[0]
        console.log(`  ✓ ${r.u}: cria no schema=${r.cria}, tabelas próprias=${r.tabelas_proprias}`)
        if (!r.cria || Number(r.tabelas_proprias) === 0) {
            falhas += 1
            console.log('  ✗ o migrador deveria criar no schema e ser dono das tabelas')
        }
    })

    console.log(falhas === 0 ? '\n✓ Aceite aprovado.' : `\n✗ ${falhas} verificação(ões) reprovaram.`)
    process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
    console.error('ABORTA:', e.message)
    process.exit(1)
})
