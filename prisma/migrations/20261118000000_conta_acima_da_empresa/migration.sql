-- A conta do cliente, um nível acima da empresa/unidade.
--
-- Nos apps a hierarquia é `Account → Workspace[]`. O Venn Desk só tinha o nível
-- de baixo (`tenants`). `accounts` é o de cima, e `tenants.account_id` é NULO
-- por omissão: o app que ainda não manda `account_id` no token continua
-- funcionando, e o vínculo preenche quando ele passar a mandar.

CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "plano" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "accounts_app_id_external_id_key" ON "accounts"("app_id", "external_id");
CREATE INDEX "accounts_app_id_nome_idx" ON "accounts"("app_id", "nome");

ALTER TABLE "accounts" ADD CONSTRAINT "accounts_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tenants" ADD COLUMN "account_id" TEXT;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_account_id_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A fila única varre os três apps por vencimento e por atualização. Sem este
-- índice, cada recarga faz varredura sequencial em `tickets`.
CREATE INDEX "tickets_app_id_atualizado_em_idx" ON "tickets"("app_id", "atualizado_em" DESC);
