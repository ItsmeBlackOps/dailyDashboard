
import { MongoClient, ObjectId } from 'mongodb';

// Correct URI from .env
const uri = 'mongodb+srv://USER:***REMOVED-MONGO-PWD***@cluster0.jlncjtp.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const client = new MongoClient(uri);

async function run() {
    console.log('Connecting to DB...');
    try {
        await client.connect();
        console.log('Connected.');
        const db = client.db('interviewSupport');

        // 1. Search for Ssanidhya
        console.log('\n--- TARGET CANDIDATE SEARCH in candidateDetails ---');
        const collectionName = 'candidateDetails';

        // Search by name first as originally requested
        let candidate = await db.collection(collectionName).findOne({
            $or: [
                { 'Candidate Name': /Ssanidhya/i },
                { 'Candidate Name': /Barraptay/i },
                { candidateName: /Ssan/i },
                { name: /Ssan/i }
            ]
        });

        if (!candidate) {
            console.log('Name search failed. Trying ID from logs: 6973ab6b509265921c4dc467');
            try {
                candidate = await db.collection(collectionName).findOne({ _id: new ObjectId('6973ab6b509265921c4dc467') });
            } catch (e) { }
        }

        if (!candidate) {
            console.log('Listing Collections:');
            const cols = await db.listCollections().toArray();
            cols.forEach(c => console.log(c.name));

            console.log('Sampling "candidates" collection:');
            const sample = await db.collection('candidates').findOne({});
            console.log('Sample ID type:', typeof sample?._id, sample?._id);
        }

        if (candidate) {
            console.log('Candidate Name:', candidate.candidateName);
            console.log('ID:', candidate._id);
            console.log('Recruiter Field:', candidate.Recruiter || candidate.recruiter);
            console.log('Recruiter Raw:', candidate.recruiterRaw);
            console.log('Expert Field:', candidate.Expert || candidate.expertRaw);
            console.log('Branch:', candidate.Branch || candidate.branch);

            // Trace Hierarchy for this specific candidate
            const recName = candidate.Recruiter || candidate.recruiter;
            if (recName) {
                console.log(`\n--- TRACING RECRUITER HIERARCHY for ${recName} ---`);
                const recUser = await db.collection('users').findOne({
                    $or: [{ email: recName }, { displayName: recName }, { name: recName }]
                });

                if (recUser) {
                    console.log(`Recruiter Email: ${recUser.email} (Role: ${recUser.role})`);
                    console.log(`TeamLead: ${recUser.teamLead}`);

                    if (recUser.teamLead) {
                        const leadUser = await findUserByName(db, recUser.teamLead);
                        if (leadUser) {
                            console.log(`MLead Email: ${leadUser.email} (Role: ${leadUser.role})`);
                            console.log(`MLead Manager: ${leadUser.manager}`);

                            if (leadUser.manager) {
                                const mamUser = await findUserByName(db, leadUser.manager);
                                console.log(`MAM Email: ${mamUser ? mamUser.email : 'NOT FOUND'} (Role: ${mamUser ? mamUser.role : 'N/A'})`);
                            }
                        } else {
                            console.log(`MLead NOT FOUND for name: ${recUser.teamLead}`);
                            // Try regex partial match?
                        }
                    }
                } else {
                    console.log('Recruiter User NOT FOUND by exact match. Trying derived...');
                    // Fallback derived check logic isn't here, but simulated in main code
                }
            }

            // Expert
            const expertName = candidate.Expert || candidate.expertRaw;
            if (expertName) {
                console.log(`\n--- EXPERT ---`);
                console.log(`Expert Field: ${expertName}`);
            }

        } else {
            console.log('Candidate Ssanidhya NOT FOUND');
        }

        console.log('\n--- FINDING DARSHAN ---');
        const darshan = await db.collection('users').findOne({
            $or: [
                { email: /darshan/i },
                { name: /darshan/i },
                { displayName: /darshan/i }
            ]
        });

        if (darshan) {
            console.log('Found User:', darshan.email);
            console.log('Role:', darshan.role);
            console.log('Name:', darshan.name);
            console.log('DisplayName:', darshan.displayName);
            console.log('TeamLead:', darshan.teamLead);
            console.log('Manager:', darshan.manager);
        } else {
            console.log('User Darshan NOT FOUND');
        }

        console.log('\n--- SIMULATING EXPERT HIERARCHY ---');
        // Simulate resolveExpertHierarchy for Ainadri
        const expertVal = 'ainadri.mandal@vizvainc.com'; // Hardcoded from previous log

        console.log(`Expert: ${expertVal}`);
        const expUser = await db.collection('users').findOne({ email: expertVal });
        if (expUser) {
            console.log(`User Found: ${expUser.email} (Role: ${expUser.role})`);
            console.log(`Lead: ${expUser.teamLead}`);

            if (expUser.teamLead) {
                const leadUser = await findUserByName(db, expUser.teamLead);
                if (leadUser) {
                    console.log(`-> Found Lead: ${leadUser.email} (Manager: ${leadUser.manager})`);

                    if (leadUser.manager) {
                        const amUser = await findUserByName(db, leadUser.manager);
                        console.log(`-> Found AM: ${amUser ? amUser.email : 'NOT FOUND'}`);
                    }
                } else {
                    console.log(`-> Lead NOT FOUND for name: ${expUser.teamLead}`);
                }
            }
        } else {
            console.log('Expert User NOT FOUND');
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.close();
    }
}

async function findUserByName(db, name) {
    if (!name) return null;
    const normalize = (n) => n ? n.toString().trim().toLowerCase().replace(/\s+/g, ' ') : '';
    const target = normalize(name);

    // Inefficient but fine for debug
    const users = await db.collection('users').find({}).toArray();
    return users.find(u => {
        if (normalize(u.displayName) === target) return true;
        if (normalize(u.name) === target) return true;
        const local = (u.email || '').split('@')[0];
        const derived = normalize(local.split(/[._\s-]+/).join(' '));
        if (derived === target) return true;
        return false;
    });
}

run();
