
import { updateRSHistory } from '@/util/rsPredictor';
import logger from '@/util/logger';

async function main() {
    logger.info("Running manual RS history update...");
    await updateRSHistory();
    logger.info("Done.");
}

main().catch(console.error);
