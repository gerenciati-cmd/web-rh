-- CreateEnum
CREATE TYPE "identity"."IdentityRole" AS ENUM ('HOLDING_ADMIN', 'HR', 'DIRECT_MANAGER', 'EMPLOYEE');

-- CreateTable
CREATE TABLE "identity"."role_assignments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "identity"."IdentityRole" NOT NULL,
    "company_id" UUID,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "assigned_by" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" UUID,

    CONSTRAINT "role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "role_assignments_user_id_revoked_at_idx" ON "identity"."role_assignments"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "role_assignments_role_revoked_at_idx" ON "identity"."role_assignments"("role", "revoked_at");

-- AddForeignKey
ALTER TABLE "identity"."role_assignments" ADD CONSTRAINT "role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
