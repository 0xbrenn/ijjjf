-- Create database if not exists
CREATE DATABASE IF NOT EXISTS dex_charts;

-- Use the database
\c dex_charts;

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create tables
CREATE TABLE IF NOT EXISTS pairs (
    address VARCHAR(42) PRIMARY KEY,
    token0 VARCHAR(42) NOT NULL,
    token1 VARCHAR(42) NOT NULL,
    token0_symbol VARCHAR(20),
    token1_symbol VARCHAR(20),
    token0_name VARCHAR(100),
    token1_name VARCHAR(100),
    token0_decimals INT DEFAULT 18,
    token1_decimals INT DEFAULT 18,
    reserve0 NUMERIC(78, 0),
    reserve1 NUMERIC(78, 0),
    total_supply NUMERIC(78, 0),
    volume_24h NUMERIC(40, 18) DEFAULT 0,
    liquidity_usd NUMERIC(40, 18) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trades (
    id SERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    transaction_index INT NOT NULL,
    log_index INT NOT NULL,
    timestamp BIGINT NOT NULL,
    pair_address VARCHAR(42) NOT NULL REFERENCES pairs(address),
    sender VARCHAR(42) NOT NULL,
    recipient VARCHAR(42) NOT NULL,
    amount0_in NUMERIC(78, 0) NOT NULL,
    amount1_in NUMERIC(78, 0) NOT NULL,
    amount0_out NUMERIC(78, 0) NOT NULL,
    amount1_out NUMERIC(78, 0) NOT NULL,
    price NUMERIC(40, 18) NOT NULL,
    volume_usd NUMERIC(40, 18),
    gas_price NUMERIC(78, 0),
    gas_used BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candles (
    id SERIAL PRIMARY KEY,
    pair_address VARCHAR(42) NOT NULL REFERENCES pairs(address),
    timeframe VARCHAR(10) NOT NULL,
    time BIGINT NOT NULL,
    open NUMERIC(40, 18) NOT NULL,
    high NUMERIC(40, 18) NOT NULL,
    low NUMERIC(40, 18) NOT NULL,
    close NUMERIC(40, 18) NOT NULL,
    volume NUMERIC(40, 18) NOT NULL,
    volume_usd NUMERIC(40, 18),
    trades INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pair_address, timeframe, time)
);

CREATE TABLE IF NOT EXISTS tokens (
    address VARCHAR(42) PRIMARY KEY,
    symbol VARCHAR(20),
    name VARCHAR(100),
    decimals INT DEFAULT 18,
    total_supply NUMERIC(78, 0),
    price_usd NUMERIC(40, 18),
    market_cap NUMERIC(40, 18),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX idx_trades_pair_timestamp ON trades(pair_address, timestamp DESC);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_block ON trades(block_number DESC);
CREATE INDEX idx_trades_tx_hash ON trades(transaction_hash);

CREATE INDEX idx_candles_lookup ON candles(pair_address, timeframe, time DESC);
CREATE INDEX idx_candles_time ON candles(time DESC);

CREATE INDEX idx_pairs_volume ON pairs(volume_24h DESC) WHERE volume_24h > 0;
CREATE INDEX idx_pairs_liquidity ON pairs(liquidity_usd DESC) WHERE liquidity_usd > 0;
CREATE INDEX idx_pairs_symbol ON pairs USING gin(token0_symbol gin_trgm_ops, token1_symbol gin_trgm_ops);

CREATE INDEX idx_tokens_symbol ON tokens USING gin(symbol gin_trgm_ops);
CREATE INDEX idx_tokens_market_cap ON tokens(market_cap DESC) WHERE market_cap > 0;

-- Create update trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_pairs_updated_at BEFORE UPDATE ON pairs
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tokens_updated_at BEFORE UPDATE ON tokens
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();