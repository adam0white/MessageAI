# D1 Database Migrations

## Running Migrations

### Local Development

1. Create a local D1 database:
```bash
npx wrangler d1 create messageai-db
```

2. Copy the database ID from the output and update `wrangler.jsonc`:
```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "messageai-db",
    "database_id": "YOUR_DATABASE_ID_HERE"
  }
]
```

3. Run migrations locally:
```bash
npx wrangler d1 execute messageai-db --local --file=./src/db/migrations/0001_initial_schema.sql
```

### Production

1. Run migrations on production database:
```bash
npx wrangler d1 execute messageai-db --remote --file=./src/db/migrations/0001_initial_schema.sql
```

## Migration Files

- `0001_initial_schema.sql` - Initial tables (users, conversations, participants, push_tokens)

## Notes

- Migrations are run manually using Wrangler CLI
- D1 supports standard SQLite syntax
- Messages and read receipts are stored in Durable Object SQLite (not D1)
- Use `--local` for development, `--remote` for production

