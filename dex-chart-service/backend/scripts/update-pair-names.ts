import { ethers } from 'ethers';
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Token ABI for fetching names
const tokenAbi = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)'
];

async function updatePairNames() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || 'https://testnet-rpc.iopn.tech');
  const db = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'dex_charts',
    user: process.env.DB_USER || 'brenn',
    password: process.env.DB_PASSWORD || ''
  });

  try {
    // Get all pairs
    const pairsResult = await db.query('SELECT * FROM pairs');
    const pairs = pairsResult.rows;
    
    console.log(`Updating ${pairs.length} pairs with token information...`);
    
    for (const pair of pairs) {
      let token0Symbol = pair.token0_symbol;
      let token1Symbol = pair.token1_symbol;
      let updated = false;
      
      // Fetch token0 info if missing
      if (!token0Symbol || token0Symbol.includes('...')) {
        if (pair.token0.toLowerCase() === '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase()) {
          token0Symbol = 'WOPN';
          updated = true;
        } else {
          try {
            const token0Contract = new ethers.Contract(pair.token0, tokenAbi, provider);
            token0Symbol = await token0Contract.symbol();
            updated = true;
          } catch (e) {
            token0Symbol = `${pair.token0.slice(0, 4)}...${pair.token0.slice(-3)}`;
          }
        }
      }
      
      // Fetch token1 info if missing
      if (!token1Symbol || token1Symbol.includes('...')) {
        if (pair.token1.toLowerCase() === '0xBc022C9dEb5AF250A526321d16Ef52E39b4DBD84'.toLowerCase()) {
          token1Symbol = 'WOPN';
          updated = true;
        } else {
          try {
            const token1Contract = new ethers.Contract(pair.token1, tokenAbi, provider);
            token1Symbol = await token1Contract.symbol();
            updated = true;
          } catch (e) {
            token1Symbol = `${pair.token1.slice(0, 4)}...${pair.token1.slice(-3)}`;
          }
        }
      }
      
      // Update database if we got new info
      if (updated) {
        await db.query(
          `UPDATE pairs SET token0_symbol = $1, token1_symbol = $2 WHERE address = $3`,
          [token0Symbol, token1Symbol, pair.address]
        );
        console.log(`Updated ${pair.address}: ${token0Symbol}/${token1Symbol}`);
      }
    }
    
    console.log('Done updating pairs!');
    process.exit(0);
  } catch (error) {
    console.error('Error updating pairs:', error);
    process.exit(1);
  }
}

updatePairNames();