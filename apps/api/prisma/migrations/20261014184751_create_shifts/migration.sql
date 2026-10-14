-- CreateTable
CREATE TABLE "attendance"."shifts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "cycle_start_date" DATE NOT NULL,
    "tolerance_minutes" INTEGER NOT NULL,
    "days" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance"."shift_assignments" (
    "employee_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL,
    "assigned_by" UUID NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("employee_id","effective_from")
);

-- CreateIndex
CREATE UNIQUE INDEX "shifts_company_id_name_key_key" ON "attendance"."shifts"("company_id", "name_key");

-- CreateIndex
CREATE INDEX "shift_assignments_shift_id_idx" ON "attendance"."shift_assignments"("shift_id");

-- AddForeignKey
ALTER TABLE "attendance"."shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "attendance"."shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
