
import { MongoClient, ObjectId } from 'mongodb';

// Hardcoded URI for Docker environment
const uri = 'mongodb://mongodb:27017/interviewSupport';
const client = new MongoClient(uri);

async function run() {
    console.log('Connecting to DB...');
    try {
        await client.connect();
        console.log('Connected.');
        const db = client.db();

        // 1. Fetch Candidate
        const candidateId = '6973ab6b509265921c4dc467';
        // Wait, is it a valid ObjectID? It looks like one.
        // User log said: [Candidate: 6973ab6b509265921c4dc467] - wait, standard Mongo IDs are 24 hex chars.
        // 6973ab6b509265921c4dc467 is 24 chars. (6+2+2+4+5+5 = 24? len("6973ab6b509265921c4dc467") = 24)

        let candidate;
        try {
            candidate = await db.collection('candidates').findOne({ _id: new ObjectId(candidateId) });
        } catch (e) {
            console.log('Invalid ID format? Trying string fallback');
            candidate = await db.collection('candidates').findOne({ _id: candidateId });
        }

        console.log('--- CANDIDATE ---');
        if (!candidate) {
            console.log('Candidate NOT FOUND with ID:', candidateId);
            // List a few candidates to see IDs?
            const sample = await db.collection('candidates').findOne({});
            console.log('Sample ID:', sample?._id);
        } else {
            console.log('Branch:', candidate.Branch || candidate.branch);
            console.log('Recruiter (field):', candidate.Recruiter || candidate.recruiter); // e.g. "Ainadri Mandal"
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
            console.log('User Name:', darshan.name);
            console.log('Display Name:', darshan.displayName);
        } else {
            console.log('User Darshan NOT FOUND');
        }

        // Check Recruiter's hierarchy
        if (candidate) {
            const recName = candidate.Recruiter || candidate.recruiter;
            if (recName) {
                console.log(`\n--- TRACING from Recruiter: ${recName} ---`);
                const recUser = await db.collection('users').findOne({
                    $or: [{ email: recName }, { displayName: recName }, { name: recName }]
                });
                if (recUser) {
                    console.log('Recruiter User Found:', recUser.email);
                    console.log('Recruiter TeamLead:', recUser.teamLead);

                    if (recUser.teamLead) {
                        const leadUser = await db.collection('users').findOne({
                            $or: [{ email: recUser.teamLead }, { displayName: recUser.teamLead }, { name: recUser.teamLead }]
                        });
                        if (leadUser) {
                            console.log('TeamLead Found:', leadUser.email);
                            console.log('TeamLead Manager:', leadUser.manager);

                            if (leadUser.manager) {
                                const mgrUser = await db.collection('users').findOne({
                                    $or: [{ email: leadUser.manager }, { displayName: leadUser.manager }, { name: leadUser.manager }]
                                });
                                console.log('Manager Found:', mgrUser ? mgrUser.email : 'None');
                            }
                        } else {
                            console.log('TeamLead User NOT FOUND for:', recUser.teamLead);
                        }
                    }
                } else {
                    console.log('Recruiter User NOT FOUND (searched by name/email)');
                }
            }
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await client.close();
        console.log('Done.');
    }
}

run();
