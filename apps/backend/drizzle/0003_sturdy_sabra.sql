CREATE TYPE "public"."cardType" AS ENUM('audio', 'text', 'url', 'image', 'video', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."jobStatus" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."jobType" AS ENUM('refetch-og-images', 'refetch-screenshots', 'process-card');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "cardType" NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb,
	"metaInfo" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"deletedAt" timestamp,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" "jobType" NOT NULL,
	"status" "jobStatus" DEFAULT 'pending' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"result" jsonb DEFAULT '{}'::jsonb,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"error" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;