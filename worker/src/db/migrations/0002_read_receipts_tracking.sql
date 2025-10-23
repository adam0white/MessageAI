-- Migration: Add read receipts tracking to conversations table
-- This allows us to track when each participant last read messages in a conversation

-- Add column to track last read timestamp for each user in a conversation
-- Format: JSON object like {"user_123": "2025-10-22T19:00:00.000Z", "user_456": "2025-10-22T18:30:00.000Z"}
ALTER TABLE conversations ADD COLUMN last_read_by TEXT DEFAULT '{}';

-- Update existing conversations to have empty object
UPDATE conversations SET last_read_by = '{}' WHERE last_read_by IS NULL;

