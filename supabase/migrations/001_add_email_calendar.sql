-- Migration 001: Add email and calendar support
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New Query)

-- 1. Add Outlook calendar event ID to bookings so we can delete events on cancellation
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS outlook_event_id TEXT;

-- 2. Track which bookings have already received a 24-hour reminder
--    The UNIQUE constraint prevents duplicate reminders if the cron fires twice
CREATE TABLE IF NOT EXISTS reminder_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id UUID REFERENCES bookings(id) ON DELETE CASCADE,
  reminder_sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(booking_id)
);

-- 3. Store the Microsoft refresh token (rotated on every use)
--    Protected: only the service role key can read this table
CREATE TABLE IF NOT EXISTS app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security on app_secrets so anon users cannot read it
ALTER TABLE app_secrets ENABLE ROW LEVEL SECURITY;

-- No SELECT policy for anon/authenticated roles = only service role can read
-- Edge Functions use the service role key so they can read/write freely

-- After running this migration, insert the Microsoft refresh token you obtained:
-- INSERT INTO app_secrets (key, value) VALUES ('ms_refresh_token', 'YOUR_REFRESH_TOKEN_HERE');
