-- Migration: Add last message preview to conversations table
-- This allows the backend to return message previews without querying Durable Objects

-- Add columns for last message preview
ALTER TABLE conversations ADD COLUMN last_message_content TEXT DEFAULT NULL;
ALTER TABLE conversations ADD COLUMN last_message_sender_id TEXT DEFAULT NULL;

-- No data migration needed - will populate as new messages are sent

