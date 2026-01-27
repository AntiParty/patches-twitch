import crypto from 'crypto';

export function getShardInfo() {
  const shardIndex = parseInt(process.env.SHARD_INDEX || '0', 10);
  const shardCount = parseInt(process.env.SHARD_COUNT || '1', 10);
  return { shardIndex, shardCount };
}

export function isUserAssignedToShard(username: string): boolean {
  const { shardIndex, shardCount } = getShardInfo();
  if (shardCount <= 1) return true;

  // Use MD5 hash of lowercase username for consistent sharding
  const hash = crypto.createHash('md5').update(username.toLowerCase()).digest('hex');
  const numericVal = parseInt(hash.substring(0, 8), 16);
  
  return (numericVal % shardCount) === shardIndex;
}