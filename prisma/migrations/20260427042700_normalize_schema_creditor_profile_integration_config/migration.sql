/*
  Warnings:

  - You are about to drop the column `asaas_customer_id` on the `User` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PixKeyType" AS ENUM ('CPF', 'CNPJ', 'PHONE', 'EMAIL', 'EVP');

-- CreateEnum
CREATE TYPE "MessageTrigger" AS ENUM ('MANUAL', 'BEFORE_DUE', 'ON_DUE', 'OVERDUE');

-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "asaas_payment_id" TEXT,
ADD COLUMN     "custom_message" TEXT,
ADD COLUMN     "is_intermediated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "platform_fee_pct" DECIMAL(65,30);

-- AlterTable
ALTER TABLE "MessageHistory" ADD COLUMN     "error_details" TEXT,
ADD COLUMN     "zapi_message_id" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "asaas_customer_id";

-- CreateTable
CREATE TABLE "CreditorProfile" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "business_name" TEXT,
    "document" TEXT,
    "pix_key" TEXT,
    "pix_key_type" "PixKeyType",
    "pix_merchant_name" VARCHAR(25),
    "pix_qr_code_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "creditor_profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" "MessageTrigger" NOT NULL,
    "body" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "zapi_instance_id" TEXT,
    "zapi_instance_token" TEXT,
    "allows_automation" BOOLEAN NOT NULL DEFAULT true,
    "asaas_customer_id" TEXT,
    "asaas_wallet_id" TEXT,
    "asaas_account_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditorProfile_user_id_key" ON "CreditorProfile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationConfig_user_id_key" ON "IntegrationConfig"("user_id");

-- AddForeignKey
ALTER TABLE "CreditorProfile" ADD CONSTRAINT "CreditorProfile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_creditor_profile_id_fkey" FOREIGN KEY ("creditor_profile_id") REFERENCES "CreditorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationConfig" ADD CONSTRAINT "IntegrationConfig_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
