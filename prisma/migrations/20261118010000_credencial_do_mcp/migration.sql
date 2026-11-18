-- A credencial do servidor MCP: uma por app e por escopo.
--
-- O app NÃO é parâmetro das ferramentas — vem da chave. Uma ferramenta que o
-- recebesse como argumento dependeria de quem chama pedir o app certo, e quem
-- chama é um modelo lendo texto escrito por terceiros.
--
-- Só o hash é guardado. A chave aparece uma vez, na criação, e nunca mais.

CREATE TYPE "mcp_scope" AS ENUM ('SUPORTE', 'ENGENHARIA');

CREATE TABLE "mcp_keys" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "escopo" "mcp_scope" NOT NULL,
    "hash" TEXT NOT NULL,
    "prefixo" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usado_em" TIMESTAMP(3),
    "revogado_em" TIMESTAMP(3),

    CONSTRAINT "mcp_keys_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mcp_keys_app_id_escopo_idx" ON "mcp_keys"("app_id", "escopo");

ALTER TABLE "mcp_keys" ADD CONSTRAINT "mcp_keys_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
