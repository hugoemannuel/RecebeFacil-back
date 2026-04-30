-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "creditor_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Client_creditor_id_user_id_key" ON "Client"("creditor_id", "user_id");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_creditor_id_fkey" FOREIGN KEY ("creditor_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
