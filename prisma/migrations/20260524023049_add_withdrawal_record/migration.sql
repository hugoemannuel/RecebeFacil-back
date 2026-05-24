-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONFIRMED', 'FAILED', 'REVERSED');

-- CreateTable
CREATE TABLE "WithdrawalRecord" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "value" DECIMAL(10,2) NOT NULL,
    "pix_key_masked" TEXT NOT NULL,
    "pix_key_type" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'PENDING',
    "asaas_transfer_id" TEXT,
    "asaas_status" TEXT,
    "failure_reason" TEXT,
    "processed_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WithdrawalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WithdrawalRecord_idempotency_key_key" ON "WithdrawalRecord"("idempotency_key");

-- CreateIndex
CREATE INDEX "WithdrawalRecord_user_id_created_at_idx" ON "WithdrawalRecord"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "WithdrawalRecord_asaas_transfer_id_idx" ON "WithdrawalRecord"("asaas_transfer_id");

-- AddForeignKey
ALTER TABLE "WithdrawalRecord" ADD CONSTRAINT "WithdrawalRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
