import { database } from '../backend/src/config/database.js';
import { userModel } from '../backend/src/models/User.js';
import { userService } from '../backend/src/services/userService.js';

async function run() {
  try {
    await database.connect();
    await userModel.initialize();

    const mmEmail = 'tushar.ahuja@silverspaceinc.com';
    const mmUser = userModel.getUserByEmail(mmEmail);

    if (!mmUser) {
      throw new Error(`MM user ${mmEmail} not found`);
    }

    const manageable = await userService.getManageableUsers({
      email: mmEmail,
      role: mmUser.role,
      teamLead: mmUser.teamLead,
      manager: mmUser.manager
    });

    console.log(JSON.stringify({
      requestedBy: mmEmail,
      role: mmUser.role,
      manageableCount: manageable.meta.count,
      sample: manageable.users.slice(0, 5)
    }, null, 2));
  } finally {
    await database.disconnect();
  }
}

run().catch((error) => {
  console.error('Smoke check failed:', error);
  process.exitCode = 1;
});
