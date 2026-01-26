
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.MONGODB_URI || 'mongodb://mongodb:27017/interviewSupport';
const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db(); // uses default from URI or 'interviewSupport' if not specified, verify? 
        // Actually URI is just server in docker usually, relying on db name in path or default. 
        // In config/database.js it uses process.env.DB_NAME || 'interviewSupport'

        const candidateId = '6973ab6b509265921c4dc467'; // From user logs
        const candidate = await db.collection('candidates').findOne({ _id: new ObjectId(candidateId) });

        console.log('--- CANDIDATE DEBUG ---');
        if (!candidate) {
            console.log('Candidate NOT FOUND');
        } else {
            console.log('ID:', candidate._id);
            console.log('Recruiter (raw):', candidate.recruiter);
            console.log('Recruiter (Capitalized):', candidate.Recruiter);
            console.log('Branch:', candidate.Branch || candidate.branch);
            console.log('Expert:', candidate.Expert || candidate.expertRaw);
        }

        console.log('\n--- DARSHAN USER DEBUG ---');
        // Search for any user with name/email like Darshan
        const users = await db.collection('users').find({
            $or: [
                { name: { $regex: 'Darshan', $options: 'i' } },
                { displayName: { $regex: 'Darshan', $options: 'i' } },
                { email: { $regex: 'Darshan', $options: 'i' } }
            ]
        }).toArray();

        users.forEach(u => {
            console.log(`User: ${u.email} | Role: ${u.role} | Name: ${u.name} | DisplayName: ${u.displayName}`);
            console.log(`  TeamLead: ${u.teamLead}`);
            console.log(`  Manager: ${u.manager}`);
        });

        console.log('\n--- HIERARCHY LOGIC SIMULATION ---');
        if (candidate) {
            // simulation of resolveHierarchyWatchers
            const watchers = [];

            // 1. Recruiter
            const recName = candidate.recruiter || candidate.Recruiter;
            console.log(`1. Recruiter Name from Candidate: "${recName}"`);

            let recUser = null;
            if (recName) {
                // Find recruiter user
                // _findEmailByName logic roughly:
                recUser = await db.collection('users').findOne({
                    $or: [
                        { email: recName.toLowerCase() }, // exact email
                        { displayName: { $regex: `^${recName}$`, $options: 'i' } },
                        { name: { $regex: `^${recName}$`, $options: 'i' } }
                    ]
                });
                if (!recUser && recName.includes('@')) {
                    recUser = await db.collection('users').findOne({ email: recName.trim().toLowerCase() });
                }
            }

            if (recUser) {
                console.log(`   -> Found Recruiter User: ${recUser.email}`);
                watchers.push(recUser.email);

                // 2. MLead
                const teamLeadName = recUser.teamLead;
                console.log(`   -> Recruiter's TeamLead: "${teamLeadName}"`);

                if (teamLeadName) {
                    const mleadUser = await findUserByName(db, teamLeadName);
                    if (mleadUser) {
                        console.log(`      -> Found MLead User: ${mleadUser.email}`);
                        watchers.push(mleadUser.email);

                        // 3. MAM
                        const managerName = mleadUser.manager;
                        console.log(`      -> MLead's Manager: "${managerName}"`);
                        if (managerName) {
                            const mamUser = await findUserByName(db, managerName);
                            if (mamUser) {
                                console.log(`         -> Found MAM User: ${mamUser.email}`);
                                watchers.push(mamUser.email);
                            } else {
                                console.log(`         -> !! MAM User NOT found for name: "${managerName}"`);
                            }
                        }
                    } else {
                        console.log(`      -> !! MLead User NOT found for name: "${teamLeadName}"`);
                    }
                }
            } else {
                console.log(`   -> !! Recruiter User NOT found for name: "${recName}"`);
            }

            console.log('Final Computed Watchers:', watchers);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}

async function findUserByName(db, name) {
    if (!name) return null;
    const normalize = (n) => n ? n.toString().trim().toLowerCase().replace(/\s+/g, ' ') : '';
    const target = normalize(name);

    // In code this is in memory, here we query
    // We can't replicate exact complexity of in-memory find, but regex match is close enough for debugging
    const users = await db.collection('users').find({}).toArray();
    return users.find(u => {
        if (normalize(u.displayName) === target) return true;
        if (normalize(u.name) === target) return true;
        // derived
        const local = (u.email || '').split('@')[0];
        const derived = normalize(local.split(/[._\s-]+/).join(' '));
        if (derived === target) return true;
        return false;
    });
}

run();
