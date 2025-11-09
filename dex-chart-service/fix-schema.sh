# Quick fix - add missing columns
psql -U brenn -d dex_charts << 'EOF'
ALTER TABLE trades ADD COLUMN IF NOT EXISTS token0_amount NUMERIC(78, 0);
ALTER TABLE trades ADD COLUMN IF NOT EXISTS token1_amount NUMERIC(78, 0);
EOF