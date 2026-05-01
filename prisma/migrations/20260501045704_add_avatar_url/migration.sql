/*
  Warnings:

  - The values [PAST_DUE] on the enum `SubStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[asaas_id]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SubStatus_new" AS ENUM ('ACTIVE', 'INACTIVE', 'PAUSED', 'CANCELED', 'OVERDUE', 'PENDING');
ALTER TABLE "Subscription" ALTER COLUMN "status" TYPE "SubStatus_new" USING ("status"::text::"SubStatus_new");
ALTER TYPE "SubStatus" RENAME TO "SubStatus_old";
ALTER TYPE "SubStatus_new" RENAME TO "SubStatus";
DROP TYPE "public"."SubStatus_old";
COMMIT;

-- AlterTable
ALTER TABLE "CreditorProfile" ADD COLUMN     "logo_url" TEXT;

-- AlterTable
ALTER TABLE "IntegrationConfig" ADD COLUMN     "split_terms_accepted_at" TIMESTAMP(3),
ADD COLUMN     "split_terms_version" TEXT;

-- AlterTable
ALTER TABLE "RecurringCharge" ADD COLUMN     "custom_message" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "asaas_id" TEXT,
ADD COLUMN     "last_payment_at" TIMESTAMP(3),
ALTER COLUMN "status" SET DEFAULT 'PENDING',
ALTER COLUMN "current_period_start" DROP NOT NULL,
ALTER COLUMN "current_period_end" DROP NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatar_url" TEXT;

-- CreateTable
CREATE TABLE "SplitTerm" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "platform_fee_pct" DECIMAL(65,30) NOT NULL DEFAULT 1.0,
    "asaas_pix_fee" TEXT NOT NULL DEFAULT 'R$ 0,99',
    "asaas_boleto_fee" TEXT NOT NULL DEFAULT 'R$ 1,99',
    "asaas_card_fee" TEXT NOT NULL DEFAULT '2.99% + R$ 0,49',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitTerm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SplitTerm_version_key" ON "SplitTerm"("version");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_asaas_id_key" ON "Subscription"("asaas_id");
