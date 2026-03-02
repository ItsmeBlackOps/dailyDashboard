import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { ROLE_DETAIL_OPTIONS } from '../constants/profileRoleDetails.js';

async function applyUserRoleDetailValidator() {
  try {
    await database.connect();
    const db = database.db;

    const validator = {
      $or: [
        { role: { $ne: 'user' } },
        {
          $and: [
            { role: 'user' },
            {
              'profile.jobRole': {
                $in: ROLE_DETAIL_OPTIONS
              }
            }
          ]
        }
      ]
    };

    const result = await db.command({
      collMod: 'users',
      validator,
      validationLevel: 'moderate',
      validationAction: 'error'
    });

    logger.info('Applied users collection role-detail validator', { result });
    console.log('Validator applied successfully');
  } catch (error) {
    logger.error('Failed to apply users collection role-detail validator', { error: error.message });
    console.error(error);
    process.exitCode = 1;
  } finally {
    await database.disconnect();
  }
}

applyUserRoleDetailValidator();

