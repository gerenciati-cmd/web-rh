-- CreateTable
CREATE TABLE "attendance"."workdays" (
    "employee_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" UUID NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "scheduled_start_at" TIMESTAMPTZ(3),
    "scheduled_end_at" TIMESTAMPTZ(3),
    "scheduled_minutes" INTEGER NOT NULL,
    "first_punch_at" TIMESTAMPTZ(3),
    "last_punch_at" TIMESTAMPTZ(3),
    "punch_count" INTEGER NOT NULL,
    "late_minutes" INTEGER NOT NULL,
    "worked_minutes" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL,
    "calculated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workdays_pkey" PRIMARY KEY ("employee_id","date")
);

-- CreateIndex
CREATE INDEX "workdays_company_id_date_idx" ON "attendance"."workdays"("company_id", "date");

-- CreateIndex
CREATE INDEX "workdays_shift_id_idx" ON "attendance"."workdays"("shift_id");

-- CreateIndex
CREATE INDEX "punches_pin_occurred_at_idx" ON "attendance"."punches"("pin", "occurred_at");

-- AddForeignKey
ALTER TABLE "attendance"."workdays" ADD CONSTRAINT "workdays_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "attendance"."shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
