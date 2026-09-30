/*
  Warnings:

  - A unique constraint covering the columns `[employee_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "identity"."users" ADD COLUMN     "employee_id" UUID;

-- CreateTable
CREATE TABLE "identity"."invitations" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "employee_id" UUID,
    "company_id" UUID,
    "token_hash" CHAR(64) NOT NULL,
    "invited_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "identity"."invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_employee_id_idx" ON "identity"."invitations"("employee_id");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "identity"."invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_employee_id_key" ON "identity"."users"("employee_id");
