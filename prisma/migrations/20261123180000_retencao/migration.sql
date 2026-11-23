-- Retenção e exclusão de dados (seção 10, Fase 8).
--
-- Duas colunas, e as duas existem para que a exclusão continue sendo LÓGICA
-- onde ela pode ser, e verificável onde não pode.
--
-- `attachments.expurgado_em`: o arquivo sai do R2 depois do prazo de retenção,
-- mas a LINHA fica. Sem ela, um anexo citado numa conversa de três anos atrás
-- viraria um link quebrado sem explicação; com ela, o Console diz "removido pela
-- política de retenção" e a trilha continua coerente.
--
-- `requesters.anonimizado_em`: marca o pedido de exclusão atendido (LGPD). O
-- nome e o e-mail são substituídos no lugar — isso é irreversível de propósito —
-- e a data registra quando, que é o que uma auditoria pede.
ALTER TABLE "attachments" ADD COLUMN "expurgado_em" TIMESTAMP(3);
ALTER TABLE "requesters" ADD COLUMN "anonimizado_em" TIMESTAMP(3);

CREATE INDEX "attachments_app_id_criado_em_idx" ON "attachments"("app_id", "criado_em");
