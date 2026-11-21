-- A ponte com o Slack (Fase 3).
--
-- Uma coluna só, e ela existe por causa de uma garantia do Slack que trabalha
-- contra nós: o Events API REENTREGA. Um timeout nosso, um deploy no meio, uma
-- instabilidade de rede e o mesmo evento chega duas ou três vezes. Sem um
-- identificador externo, cada reentrega viraria outra nota interna, e a thread
-- do chamado passaria a mentir sobre o que foi dito.
--
-- `ts` do Slack é único por canal e imutável, então serve de chave. Fica
-- anulável porque mensagem de widget, de Console e de IA não tem id externo —
-- e, no Postgres, nulos não colidem em índice único, de modo que o mesmo
-- índice cobre as duas situações sem índice parcial.
ALTER TABLE "ticket_messages" ADD COLUMN "externo_id" TEXT;

CREATE UNIQUE INDEX "ticket_messages_app_id_externo_id_key"
    ON "ticket_messages"("app_id", "externo_id");
