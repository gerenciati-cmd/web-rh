-- AlterTable
ALTER TABLE "attendance"."devices" ADD COLUMN     "clock_offset_measured_at" TIMESTAMPTZ(3),
ADD COLUMN     "clock_offset_seconds" INTEGER,
ADD COLUMN     "site_id" UUID;
