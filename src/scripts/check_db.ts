
import { Channel, StreamSession } from '../db';

async function check() {
  const user = await Channel.findOne({ where: { username: 'slopo_master' } });
  console.log('Channel:', user ? user.toJSON() : 'Not found');
  
  const sessions = await StreamSession.findAll();
  console.log('Sessions:', JSON.stringify(sessions, null, 2));
}

check();
