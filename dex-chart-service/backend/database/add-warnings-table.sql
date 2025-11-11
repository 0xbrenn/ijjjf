-- Create token_warnings table
CREATE TABLE IF NOT EXISTS token_warnings (
    id SERIAL PRIMARY KEY,
    token_address VARCHAR(42) NOT NULL REFERENCES tokens(address),
    warning_type VARCHAR(50) NOT NULL,
    message TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'warning',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(token_address, warning_type)
);

CREATE INDEX idx_token_warnings_address ON token_warnings(token_address);