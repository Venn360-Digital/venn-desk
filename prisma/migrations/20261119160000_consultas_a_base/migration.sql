-- Uma consulta à base de conhecimento: o que foi perguntado e o que voltou.
--
-- É o que transforma a base num ciclo em vez de um arquivo. As perguntas que
-- voltam VAZIAS são a lista do que escrever em seguida; as leituras dizem quais
-- artigos valem manter. Sem isto, quem escreve adivinha.
--
-- `artigo_lido_id` NÃO é chave estrangeira de propósito: artigo apagado
-- logicamente ou arquivado continua tendo sido lido, e o registro não deve
-- impedir nem acompanhar a vida dele.

CREATE TABLE "kb_consultas" (
    "id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "origem" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "artigos_devolvidos" TEXT[],
    "artigo_lido_id" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kb_consultas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kb_consultas_app_id_criado_em_idx" ON "kb_consultas"("app_id", "criado_em");
CREATE INDEX "kb_consultas_app_id_artigo_lido_id_idx" ON "kb_consultas"("app_id", "artigo_lido_id");

ALTER TABLE "kb_consultas" ADD CONSTRAINT "kb_consultas_app_id_fkey"
    FOREIGN KEY ("app_id") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
