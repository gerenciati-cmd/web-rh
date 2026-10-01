-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "attendance";

-- CreateTable
CREATE TABLE "attendance"."devices" (
    "id" UUID NOT NULL,
    "serial_number" VARCHAR(64) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "registered_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3),

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance"."punches" (
    "id" UUID NOT NULL,
    "device_id" UUID NOT NULL,
    "pin" VARCHAR(32) NOT NULL,
    "device_local_time" CHAR(19) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "verify_mode" VARCHAR(16) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "punches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devices_serial_number_key" ON "attendance"."devices"("serial_number");

-- CreateIndex
CREATE INDEX "punches_device_id_occurred_at_idx" ON "attendance"."punches"("device_id", "occurred_at");

-- CreateIndex
CREATE INDEX "punches_occurred_at_idx" ON "attendance"."punches"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "punches_device_id_pin_device_local_time_key" ON "attendance"."punches"("device_id", "pin", "device_local_time");

-- AddForeignKey
ALTER TABLE "attendance"."punches" ADD CONSTRAINT "punches_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "attendance"."devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
