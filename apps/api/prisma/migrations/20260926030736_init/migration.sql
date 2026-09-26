-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "employees";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "organization";

-- CreateEnum
CREATE TYPE "employees"."EmployeeStatus" AS ENUM ('ACTIVE', 'TERMINATED');

-- CreateTable
CREATE TABLE "organization"."companies" (
    "id" UUID NOT NULL,
    "legal_name" VARCHAR(200) NOT NULL,
    "tax_id" VARCHAR(20) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employees"."employees" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "national_id_country" CHAR(2) NOT NULL,
    "national_id_number" VARCHAR(20) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "position_title" VARCHAR(150),
    "hire_date" DATE NOT NULL,
    "status" "employees"."EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_country_tax_id_key" ON "organization"."companies"("country", "tax_id");

-- CreateIndex
CREATE INDEX "employees_company_id_status_idx" ON "employees"."employees"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "employees_company_id_national_id_country_national_id_number_key" ON "employees"."employees"("company_id", "national_id_country", "national_id_number");
