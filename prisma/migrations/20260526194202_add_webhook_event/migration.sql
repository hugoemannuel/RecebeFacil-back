-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "asaas_event_id" TEXT,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_asaas_event_id_key" ON "WebhookEvent"("asaas_event_id");

-- CreateIndex
CREATE INDEX "WebhookEvent_source_event_type_idx" ON "WebhookEvent"("source", "event_type");

-- CreateIndex
CREATE INDEX "WebhookEvent_processed_created_at_idx" ON "WebhookEvent"("processed", "created_at");

-- CreateIndex
CREATE INDEX "Charge_asaas_payment_id_idx" ON "Charge"("asaas_payment_id");
