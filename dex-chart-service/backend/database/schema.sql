-- Enhanced DEX Analytics Database Schema
-- Optimized for high-performance queries and real-time analytics

-- Drop existing tables if needed (be careful in production!)
DROP TABLE IF EXISTS token_holders CASCADE;
DROP TABLE IF EXISTS token_socials CASCADE;
DROP TABLE IF EXISTS alerts CASCADE;
DROP TABLE IF EXISTS watchlists CASCADE;
DROP TABLE IF EXISTS token_metrics CASCADE;
DROP TABLE IF EXISTS liquidity_events CASCADE;
DROP TABLE IF EXISTS candles CASCADE;
DROP TABLE IF EXISTS trades CASCADE;
DROP TABLE IF EXISTS tokens CASCADE;
DROP TABLE IF EXISTS pairs CASCADE;

-- Tokens table with comprehensive metadata
CREATE TABLE tokens (
    address VARCHAR(42) PRIMARY KEY,
    symbol VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    decimals INT NOT NULL DEFAULT 18,
    total_supply NUMERIC(78, 0),
    circulating_supply NUMERIC(78, 0),
    logo_uri TEXT,
    website TEXT,
    telegram TEXT,
    twitter TEXT,
    description TEXT,
    contract_verified BOOLEAN DEFAULT false,
    honeypot_status VARCHAR(20) DEFAULT 'unknown', -- 'safe', 'warning', 'danger', 'unknown'
    buy_tax NUMERIC(5, 2),
    sell_tax NUMERIC(5, 2),
    max_buy NUMERIC(78, 0),
    max_sell NUMERIC(78, 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pairs table with additional metrics
CREATE TABLE pairs (
    address VARCHAR(42) PRIMARY KEY,
    token0 VARCHAR(42) NOT NULL REFERENCES tokens(address),
    token1 VARCHAR(42) NOT NULL REFERENCES tokens(address),
    token0_symbol VARCHAR(50),
    token1_symbol VARCHAR(50),
    token0_decimals INT DEFAULT 18,
    token1_decimals INT DEFAULT 18,
    factory VARCHAR(42) NOT NULL,
    reserve0 NUMERIC(78, 0),
    reserve1 NUMERIC(78, 0),
    total_supply NUMERIC(78, 0),
    created_at_block BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token0, token1, factory)
);

-- Enhanced trades table
CREATE TABLE trades (
    id SERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    transaction_hash VARCHAR(66) NOT NULL,
    log_index INT NOT NULL,
    timestamp BIGINT NOT NULL,
    pair_address VARCHAR(42) NOT NULL REFERENCES pairs(address),
    token0_amount NUMERIC(78, 0) NOT NULL,
    token1_amount NUMERIC(78, 0) NOT NULL,
    amount_in_usd NUMERIC(40, 18),
    amount_out_usd NUMERIC(40, 18),
    price_token0_usd NUMERIC(40, 18),
    price_token1_usd NUMERIC(40, 18),
    price_token0_opn NUMERIC(40, 18),
    price_token1_opn NUMERIC(40, 18),
    gas_used BIGINT,
    gas_price NUMERIC(78, 0),
    maker VARCHAR(42) NOT NULL,
    trade_type VARCHAR(10), -- 'buy' or 'sell'
    price_impact NUMERIC(10, 6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(transaction_hash, log_index)
);

-- Optimized candles table for multiple timeframes
CREATE TABLE candles (
    id SERIAL PRIMARY KEY,
    pair_address VARCHAR(42) NOT NULL REFERENCES pairs(address),
    timeframe VARCHAR(10) NOT NULL, -- '1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'
    time BIGINT NOT NULL,
    open_usd NUMERIC(40, 18) NOT NULL,
    high_usd NUMERIC(40, 18) NOT NULL,
    low_usd NUMERIC(40, 18) NOT NULL,
    close_usd NUMERIC(40, 18) NOT NULL,
    open_opn NUMERIC(40, 18) NOT NULL,
    high_opn NUMERIC(40, 18) NOT NULL,
    low_opn NUMERIC(40, 18) NOT NULL,
    close_opn NUMERIC(40, 18) NOT NULL,
    volume_usd NUMERIC(40, 18) NOT NULL,
    volume_token0 NUMERIC(78, 0) NOT NULL,
    volume_token1 NUMERIC(78, 0) NOT NULL,
    buy_volume_usd NUMERIC(40, 18),
    sell_volume_usd NUMERIC(40, 18),
    trades_count INT NOT NULL DEFAULT 0,
    buyers_count INT DEFAULT 0,
    sellers_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(pair_address, timeframe, time)
);

-- Token metrics for advanced analytics
CREATE TABLE token_metrics (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(42) NOT NULL REFERENCES tokens(address),
    timestamp BIGINT NOT NULL,
    price_usd NUMERIC(40, 18),
    price_opn NUMERIC(40, 18),
    market_cap_usd NUMERIC(40, 18),
    fdv_usd NUMERIC(40, 18),
    volume_24h_usd NUMERIC(40, 18),
    volume_change_24h NUMERIC(10, 2),
    price_change_5m NUMERIC(10, 2),
    price_change_1h NUMERIC(10, 2),
    price_change_6h NUMERIC(10, 2),
    price_change_24h NUMERIC(10, 2),
    price_change_7d NUMERIC(10, 2),
    price_change_30d NUMERIC(10, 2),
    liquidity_usd NUMERIC(40, 18),
    liquidity_opn NUMERIC(40, 18),
    holder_count INT,
    tx_count_24h INT,
    unique_buyers_24h INT,
    unique_sellers_24h INT,
    buy_pressure NUMERIC(5, 2), -- Buy volume / Total volume %
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token_address, timestamp)
);

-- Liquidity events tracking
CREATE TABLE liquidity_events (
    id SERIAL PRIMARY KEY,
    pair_address VARCHAR(42) NOT NULL REFERENCES pairs(address),
    transaction_hash VARCHAR(66) NOT NULL,
    block_number BIGINT NOT NULL,
    timestamp BIGINT NOT NULL,
    event_type VARCHAR(20) NOT NULL, -- 'add', 'remove'
    token0_amount NUMERIC(78, 0),
    token1_amount NUMERIC(78, 0),
    liquidity_minted NUMERIC(78, 0),
    liquidity_burned NUMERIC(78, 0),
    provider VARCHAR(42) NOT NULL,
    amount_usd NUMERIC(40, 18),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token holders tracking
CREATE TABLE token_holders (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(42) NOT NULL REFERENCES tokens(address),
    holder_address VARCHAR(42) NOT NULL,
    balance NUMERIC(78, 0) NOT NULL,
    percentage NUMERIC(10, 6),
    first_tx_timestamp BIGINT,
    last_tx_timestamp BIGINT,
    is_contract BOOLEAN DEFAULT false,
    label VARCHAR(100), -- 'team', 'marketing', 'liquidity', etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token_address, holder_address)
);

-- User watchlists
CREATE TABLE watchlists (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    pair_address VARCHAR(42) NOT NULL REFERENCES pairs(address),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_address, pair_address)
);

-- Price alerts
CREATE TABLE alerts (
    id SERIAL PRIMARY KEY,
    user_address VARCHAR(42) NOT NULL,
    pair_address VARCHAR(42) NOT NULL REFERENCES pairs(address),
    alert_type VARCHAR(20) NOT NULL, -- 'price_above', 'price_below', 'volume_above', 'liquidity_below'
    threshold NUMERIC(40, 18) NOT NULL,
    is_active BOOLEAN DEFAULT true,
    triggered_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Token social links and metadata
CREATE TABLE token_socials (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(42) NOT NULL REFERENCES tokens(address),
    platform VARCHAR(50) NOT NULL, -- 'website', 'telegram', 'twitter', 'discord', 'medium'
    url TEXT NOT NULL,
    verified BOOLEAN DEFAULT false,
    followers_count INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token_address, platform)
);

-- Create optimized indexes for high-performance queries
-- Trade queries
CREATE INDEX idx_trades_pair_timestamp ON trades(pair_address, timestamp DESC);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_block ON trades(block_number DESC);
CREATE INDEX idx_trades_maker ON trades(maker, timestamp DESC);
CREATE INDEX idx_trades_type ON trades(trade_type, timestamp DESC);
CREATE INDEX idx_trades_volume ON trades(amount_in_usd DESC) WHERE amount_in_usd > 100;

-- Candle queries
CREATE INDEX idx_candles_lookup ON candles(pair_address, timeframe, time DESC);
CREATE INDEX idx_candles_volume ON candles(volume_usd DESC);
CREATE INDEX idx_candles_recent ON candles(time DESC) WHERE time > (EXTRACT(EPOCH FROM NOW()) - 86400);

-- Pair queries
CREATE INDEX idx_pairs_tokens ON pairs(token0, token1);
CREATE INDEX idx_pairs_created ON pairs(created_at DESC);
CREATE INDEX idx_pairs_factory ON pairs(factory);

-- Token metrics queries
CREATE INDEX idx_metrics_token_time ON token_metrics(token_address, timestamp DESC);
CREATE INDEX idx_metrics_gainers ON token_metrics(price_change_24h DESC) WHERE price_change_24h > 0;
CREATE INDEX idx_metrics_losers ON token_metrics(price_change_24h ASC) WHERE price_change_24h < 0;
CREATE INDEX idx_metrics_volume ON token_metrics(volume_24h_usd DESC);
CREATE INDEX idx_metrics_mcap ON token_metrics(market_cap_usd DESC);

-- Holder queries
CREATE INDEX idx_holders_token ON token_holders(token_address, balance DESC);
CREATE INDEX idx_holders_address ON token_holders(holder_address);
CREATE INDEX idx_holders_whales ON token_holders(balance DESC) WHERE percentage > 1;

-- Alert queries
CREATE INDEX idx_alerts_active ON alerts(user_address, is_active) WHERE is_active = true;
CREATE INDEX idx_alerts_pair ON alerts(pair_address, alert_type) WHERE is_active = true;

-- Full text search on token names and symbols
CREATE INDEX idx_tokens_search ON tokens USING gin(to_tsvector('english', name || ' ' || symbol));

-- Create materialized views for performance
CREATE MATERIALIZED VIEW top_gainers_24h AS
SELECT 
    t.address,
    t.symbol,
    t.name,
    tm.price_usd,
    tm.price_change_24h,
    tm.volume_24h_usd,
    tm.market_cap_usd
FROM tokens t
JOIN token_metrics tm ON t.address = tm.token_address
WHERE tm.timestamp = (SELECT MAX(timestamp) FROM token_metrics WHERE token_address = t.address)
    AND tm.price_change_24h > 0
ORDER BY tm.price_change_24h DESC
LIMIT 100;

CREATE INDEX idx_mv_gainers ON top_gainers_24h(price_change_24h DESC);

-- Create update triggers
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_tokens_modtime BEFORE UPDATE ON tokens FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_pairs_modtime BEFORE UPDATE ON pairs FOR EACH ROW EXECUTE FUNCTION update_modified_column();
CREATE TRIGGER update_holders_modtime BEFORE UPDATE ON token_holders FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Refresh materialized views periodically (run this via cron)
-- REFRESH MATERIALIZED VIEW CONCURRENTLY top_gainers_24h;