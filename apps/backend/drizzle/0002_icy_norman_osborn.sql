CREATE TYPE "public"."cardType" AS ENUM('audio', 'text', 'url', 'image', 'video');--> statement-breakpoint
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
ALTER TABLE "cards" ADD CONSTRAINT "cards_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
-- Create full-text GIN index on dynamic card content
CREATE INDEX idx_cards_data_fts ON cards
USING GIN (
  to_tsvector(
    'english',
    COALESCE(data->>'content', '') || ' ' ||
    COALESCE(data->>'url', '') || ' ' ||
    COALESCE(data->>'transcription', '') || ' ' ||
    COALESCE(data->>'subtitles', '')
  )
);
