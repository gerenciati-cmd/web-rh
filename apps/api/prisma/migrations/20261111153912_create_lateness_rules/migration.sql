-- CreateTable
CREATE TABLE "attendance"."lateness_rules" (
    "company_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "threshold" INTEGER NOT NULL,
    "period" VARCHAR(10) NOT NULL,
    "set_at" TIMESTAMPTZ(3) NOT NULL,
    "set_by" UUID NOT NULL,

    CONSTRAINT "lateness_rules_pkey" PRIMARY KEY ("company_id","effective_from")
);
