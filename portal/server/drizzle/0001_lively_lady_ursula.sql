ALTER TABLE "mails" ADD COLUMN "envelope_from" text;--> statement-breakpoint
ALTER TABLE "mails" ADD COLUMN "reply_to_addr" text;--> statement-breakpoint
ALTER TABLE "mails" ADD COLUMN "reply_to_name" text;--> statement-breakpoint
ALTER TABLE "mails" ADD COLUMN "is_favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "mails_is_favorite_idx" ON "mails" USING btree ("is_favorite");