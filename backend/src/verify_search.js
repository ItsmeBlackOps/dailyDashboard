import { MongoClient } from 'mongodb';
import { config } from 'dotenv';
config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function run() {
    try {
        await client.connect();
        const db = client.db('interviewSupport');

        // 1. Get Lead (Anusree) and Team
        const leadEmail = 'anusree.vasudevan@vizvainc.com';
        const lead = await db.collection('users').findOne({ email: leadEmail });
        if (!lead) throw new Error("Lead Anusree not found");

        console.log(`Lead: ${lead.email} (${lead.role})`);

        const teamMembers = await db.collection('users').find({ teamLead: new RegExp(lead.email.split('@')[0], 'i') }).toArray();
        const teamEmails = teamMembers.map(u => u.email.toLowerCase());
        if (teamEmails.length === 0) teamEmails.push('shraavana@silverspaceinc.com', 'hridhya.kk@silverspaceinc.com');
        console.log(`Team: ${teamEmails.join(', ')}`);

        // 2. Test: Find Assigned Task
        console.log('\n[TEST 1] Checking Assigned Task Existence');
        const assignedQuery = { assignedTo: { $regex: teamEmails.join('|'), $options: 'i' } };
        const assignedTask = await db.collection('taskBody').findOne(assignedQuery);
        console.log(`Result: ${assignedTask ? 'FOUND' : 'NOT FOUND'} (Assigned to: ${assignedTask?.assignedTo})`);

        // 3. Test: Find Suggested Task
        console.log('\n[TEST 2] Checking Suggested Task Existence');
        const teamMemberRegex = new RegExp(teamEmails.join('|'), 'i');
        const suggestionDetail = await db.collection('candidateDetails').findOne({ Expert: teamMemberRegex });

        if (suggestionDetail) {
            console.log(`Found CandidateDetail: ${suggestionDetail['Candidate Name']} -> Expert: ${suggestionDetail.Expert}`);
            const taskForIt = await db.collection('taskBody').findOne({ 'Candidate Name': suggestionDetail['Candidate Name'] });
            if (taskForIt) {
                console.log(`Found TaskBody: ${taskForIt._id} (Assigned To: ${taskForIt.assignedTo})`);
                console.log(`Expectation: Since this is Suggested to Team, Anusree SHOULD see it in new search.`);
            } else {
                console.log('No TaskBody found for this candidate detail.');
            }
        } else {
            console.log('No suggestions found for this team in CandidateDetails.');
        }

        // 4. Test: Upcoming Filter
        console.log('\n[TEST 3] Checking Date Formats for Upcoming Filter');
        const sample = await db.collection('taskBody').findOne({ "Date of Interview": { $exists: true } });
        if (sample) {
            console.log(`Sample Date Format: "${sample['Date of Interview']}"`);
        }

    } catch (e) {
        console.error(e);
    } finally {
        await client.close();
    }
}
run();
