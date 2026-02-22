-- Migration 002: Add cancel token for student self-cancellation
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS cancel_token UUID DEFAULT gen_random_uuid();

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS bookings_cancel_token_idx ON bookings(cancel_token);
