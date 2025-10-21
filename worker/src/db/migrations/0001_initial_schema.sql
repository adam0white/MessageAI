-- D1 Database Initial Schema
-- Migration: 0001
-- Created: 2025-10-21
-- Description: Create initial tables for users, conversations, messages, and read receipts

-- Users table (synced from Clerk via webhook)
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    clerk_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT,
    avatar_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_users_clerk_id ON users(clerk_id);
CREATE INDEX idx_users_email ON users(email);

-- Conversations table
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL CHECK(type IN ('direct', 'group')),
    name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT
);

CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC);
CREATE INDEX idx_conversations_created_at ON conversations(created_at DESC);

-- Conversation participants (junction table)
CREATE TABLE conversation_participants (
    conversation_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    role TEXT NOT NULL CHECK(role IN ('admin', 'member')) DEFAULT 'member',
    PRIMARY KEY (conversation_id, user_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_participants_conversation ON conversation_participants(conversation_id);
CREATE INDEX idx_participants_user ON conversation_participants(user_id);

-- Push notification tokens (for Expo notifications)
CREATE TABLE push_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL CHECK(platform IN ('ios', 'android', 'web')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_push_tokens_user ON push_tokens(user_id);
CREATE INDEX idx_push_tokens_token ON push_tokens(token);

