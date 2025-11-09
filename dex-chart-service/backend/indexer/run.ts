import * as dotenv from 'dotenv';
import { logger } from '../utils/logger';
import EnhancedDexIndexer from './index';

dotenv.config();

// Create a custom indexer that overrides the initializeDatabase method
class CustomIndexer extends EnhancedDexIndexer {
  protected async initializeDatabase() {
    try {
      // Just verify connection without loading schema
      await this.db.query('SELECT 1');
      logger.info('✅ Database connected - using existing schema');
      
      // Verify tables exist
      const result = await this.db.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
      `);
      
      logger.info(`Found ${result.rows.length} tables in database`);
    } catch (error) {
      logger.error('Database connection error:', error);
      throw error;
    }
  }
}

async function main() {
  logger.info('Starting DEX Indexer...');
  
  const indexer = new CustomIndexer({
    rpcUrl: process.env.RPC_URL!,
    dbConfig: {
      host: process.env.DB_HOST,
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD
    },
    redisConfig: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6379')
    },
    factoryAddress: process.env.FACTORY_ADDRESS!,
    routerAddress: process.env.ROUTER_ADDRESS!
  });

  await indexer.start();
}

main().catch(error => {
  logger.error('Indexer failed:', error);
  process.exit(1);
});