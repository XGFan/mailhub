CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mail_id" uuid NOT NULL,
	"filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"storage_path" text NOT NULL,
	"content_id" text,
	"is_inline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"r2_key" text NOT NULL,
	"message_id" text,
	"to_addr" text,
	"from_addr" text,
	"from_name" text,
	"subject" text,
	"date" timestamp with time zone,
	"received_at" timestamp with time zone NOT NULL,
	"text_body" text,
	"html_sanitized" text,
	"snippet" text,
	"size_bytes" integer,
	"has_attachments" boolean DEFAULT false NOT NULL,
	"is_spam" boolean DEFAULT false NOT NULL,
	"auth_results" text,
	"raw_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mails_r2_key_unique" UNIQUE("r2_key")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"show_remote_images" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_mail_id_mails_id_fk" FOREIGN KEY ("mail_id") REFERENCES "public"."mails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mails_message_id_idx" ON "mails" USING btree ("message_id");