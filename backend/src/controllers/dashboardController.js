import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import { userModel } from '../models/User.js';
import moment from 'moment-timezone';

const EST_TIMEZONE = 'America/New_York';

export class DashboardController {
    constructor() {
        // Lazy access via getters
    }

    get taskCollection() {
        return database.getCollection('taskBody');
    }

    get candidateCollection() {
        return database.getCollection('candidateDetails');
    }

    get userCollection() {
        return database.getCollection('users');
    }

    calculateDateRange(period, startDate, endDate) {
        if (startDate && endDate) {
            return {
                start: moment.tz(startDate, EST_TIMEZONE).startOf('day').toDate(),
                end: moment.tz(endDate, EST_TIMEZONE).endOf('day').toDate()
            };
        }

        const end = moment.tz(EST_TIMEZONE).endOf('day');
        let start = moment.tz(EST_TIMEZONE).startOf('day');

        switch (period) {
            case 'week':
                start = moment.tz(EST_TIMEZONE).startOf('week');
                break;
            case 'month':
                start = moment.tz(EST_TIMEZONE).startOf('month');
                break;
            case 'year':
                start = moment.tz(EST_TIMEZONE).startOf('year');
                break;
            default:
                // 'day' is default
                break;
        }
        return { start: start.toDate(), end: end.toDate() };
    }

    getRoundNormalizationLogic() {
        return {
            $let: {
                vars: {
                    rawRound: { $ifNull: ['$actualRound', '$Interview Round'] }
                },
                in: {
                    $cond: [
                        { $regexMatch: { input: '$$rawRound', regex: /loop/i } },
                        'Loop',
                        '$$rawRound'
                    ]
                }
            }
        };
    }

    /**
     * Scoping for TASK queries (taskBody collection)
     * Expects normalized fields: senderRecruiterLower, assignedExpertLower, effectiveBranch
     */
    async getScopedMatchForTasks(user, baseMatch = {}) {
        if (!user) return baseMatch;
        const role = (user.role || '').toLowerCase();
        const email = (user.email || '').toLowerCase();

        // Admin: See all
        if (role === 'admin') {
            return baseMatch;
        }

        // Recruiter: See self as sender
        if (role === 'recruiter') {
            return {
                ...baseMatch,
                senderRecruiterLower: email
            };
        }

        // Expert (User): See assigned tasks
        if (role === 'user' || role === 'expert') {
            return {
                ...baseMatch,
                assignedExpertLower: email
            };
        }

        // Lead/MLead/AM/MAM: See Team + Self
        if (['lead', 'mlead', 'am', 'mam'].includes(role)) {
            let teamEmails = [];

            if (role === 'mam') {
                // MAM: Teams under him
                const mamName = userModel.formatDisplayNameFromEmail(email);
                const users = await this.userCollection.find({
                    manager: { $regex: mamName, $options: 'i' }
                }).toArray();
                teamEmails = users.map(u => u.email.toLowerCase());
            } else {
                // Lead/AM: Use existing logic
                teamEmails = userModel.getTeamEmails(email, role, user.teamLead);
            }

            teamEmails.push(email);

            return {
                ...baseMatch,
                $or: [
                    { senderRecruiterLower: { $in: teamEmails } },
                    { assignedExpertLower: { $in: teamEmails } }
                ]
            };
        }

        // MM: Whole Branch
        if (role === 'mm') {
            const userProfile = await userModel.getUserProfileMetadata(email);
            let branch = userProfile?.metadata?.branch;

            // Hardcoded Logic for MM
            if (email.includes('tushar.ahuja')) branch = 'GGR';
            if (email.includes('aryan.mishra')) branch = 'LKN';
            if (email.includes('akash.avasthi')) branch = 'AHM';

            if (branch) {
                return {
                    ...baseMatch,
                    effectiveBranch: { $regex: new RegExp(`^${branch}$`, 'i') }
                };
            }
            return {
                ...baseMatch,
                senderRecruiterLower: email
            };
        }

        return baseMatch;
    }

    /**
     * Scoping for CANDIDATE queries (candidateDetails collection)
     * Expects normalized fields: recruiterEmailLower, expertEmailLower, branchUpper
     */
    async getScopedMatchForCandidates(user, baseMatch = {}) {
        if (!user) return baseMatch;
        const role = (user.role || '').toLowerCase();
        const email = (user.email || '').toLowerCase();

        // Admin: See all
        if (role === 'admin') {
            return baseMatch;
        }

        // Recruiter: See self as owner
        if (role === 'recruiter') {
            return {
                ...baseMatch,
                recruiterEmailLower: email
            };
        }

        // Expert (User): See assigned candidates
        if (role === 'user' || role === 'expert') {
            return {
                ...baseMatch,
                expertEmailLower: email
            };
        }

        // Lead/MLead/AM/MAM: See Team + Self
        if (['lead', 'mlead', 'am', 'mam'].includes(role)) {
            let teamEmails = [];

            if (role === 'mam') {
                const mamName = userModel.formatDisplayNameFromEmail(email);
                const users = await this.userCollection.find({
                    manager: { $regex: mamName, $options: 'i' }
                }).toArray();
                teamEmails = users.map(u => u.email.toLowerCase());
            } else {
                teamEmails = userModel.getTeamEmails(email, role, user.teamLead);
            }

            teamEmails.push(email);

            return {
                ...baseMatch,
                $or: [
                    { recruiterEmailLower: { $in: teamEmails } },
                    { expertEmailLower: { $in: teamEmails } }
                ]
            };
        }

        // MM: Whole Branch
        if (role === 'mm') {
            const userProfile = await userModel.getUserProfileMetadata(email);
            let branch = userProfile?.metadata?.branch;

            if (email.includes('tushar.ahuja')) branch = 'GGR';
            if (email.includes('aryan.mishra')) branch = 'LKN';
            if (email.includes('akash.avasthi')) branch = 'AHM';

            if (branch) {
                return {
                    ...baseMatch,
                    branchUpper: branch.toUpperCase()
                };
            }
            return {
                ...baseMatch,
                recruiterEmailLower: email
            };
        }

        return baseMatch;
    }


    async getRecruiterStats(req, res) {
        try {
            const { period, startDate, endDate, branch, recruiterEmail, dateBasis } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);
            const user = req.user;

            // Fix: Use correct field path for receivedDateTime (not source.receivedDateTime)
            const dateField = dateBasis === 'received' ? 'receivedDateTime' : 'Date of Interview';
            const isReceivedDate = dateBasis === 'received';

            let pipeline = [
                {
                    $lookup: {
                        from: 'candidateDetails',
                        let: { emailId: '$Email ID' },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$Email ID', '$$emailId'] } } },
                            // Fix: Deduplicate - only get candidate docs, pick latest
                            { $match: { docType: { $in: [null, 'candidate'] } } },
                            { $sort: { updatedAt: -1 } },
                            { $limit: 1 }
                        ],
                        as: 'candidateInfo'
                    }
                },
                { $unwind: { path: '$candidateInfo', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        // Fix: Normalize all identity fields to lowercase
                        senderRecruiterLower: { $toLower: { $ifNull: ['$sender', ''] } },
                        recruiterEmailLower: { $toLower: { $ifNull: ['$candidateInfo.Recruiter', ''] } },
                        assignedExpertLower: {
                            $toLower: {
                                $cond: {
                                    if: { $ne: [{ $ifNull: ['$assignedTo', ''] }, ''] },
                                    then: '$assignedTo',
                                    else: { $ifNull: ['$candidateInfo.Expert', ''] }
                                }
                            }
                        },
                        effectiveBranch: { $toUpper: { $ifNull: ['$candidateInfo.Branch', 'UNKNOWN'] } },
                        normalizedRound: this.getRoundNormalizationLogic(),

                        // Fix: Convert Date of Interview to proper Date type
                        interviewDate: {
                            $dateFromString: {
                                dateString: '$Date of Interview',
                                format: '%m/%d/%Y',
                                onError: null
                            }
                        },

                        // Fix: Improved notDone logic with proper datetime handling
                        // Parse interview end time to get full datetime
                        isNotDone: {
                            $let: {
                                vars: {
                                    interviewDate: {
                                        $dateFromString: {
                                            dateString: '$Date of Interview',
                                            format: '%m/%d/%Y',
                                            timezone: EST_TIMEZONE,
                                            onError: null
                                        }
                                    },
                                    // Parse end time (format: "HH:mm" or "HH:mm AM/PM")
                                    endTimeStr: { $ifNull: ['$End Time Of Interview', '23:59'] }
                                },
                                in: {
                                    $cond: {
                                        if: { $eq: ['$$interviewDate', null] },
                                        then: false,
                                        else: {
                                            $and: [
                                                // Interview date+time is in the past
                                                {
                                                    $lt: [
                                                        '$$interviewDate',
                                                        moment.tz(EST_TIMEZONE).toDate()
                                                    ]
                                                },
                                                // Status is not completed/done/cancelled/rescheduled
                                                {
                                                    $not: {
                                                        $in: [
                                                            { $toLower: { $ifNull: ['$status', ''] } },
                                                            ['completed', 'done', 'cancelled', 'rescheduled']
                                                        ]
                                                    }
                                                }
                                            ]
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            ];

            // Fix: Apply proper date filtering with Date type comparison
            const dateMatch = {};
            if (isReceivedDate) {
                // For receivedDateTime, use ISO date comparison
                dateMatch.receivedDateTime = {
                    $gte: start.toISOString(),
                    $lte: end.toISOString()
                };
            } else {
                // For Date of Interview, use converted Date field
                dateMatch.interviewDate = {
                    $gte: start,
                    $lte: end
                };
            }
            pipeline.push({ $match: dateMatch });

            // Fix: Use new task scoping helper with normalized fields
            const scopedMatch = await this.getScopedMatchForTasks(user, {
                ...(branch ? { effectiveBranch: branch.toUpperCase() } : {}),
                ...(recruiterEmail ? { senderRecruiterLower: recruiterEmail.toLowerCase() } : {})
            });
            pipeline.push({ $match: scopedMatch });

            // Exclude .co.uk emails
            pipeline.push({
                $match: {
                    senderRecruiterLower: { $not: { $regex: /\.co\.uk$/i } }
                }
            });

            pipeline.push(
                {
                    $group: {
                        _id: '$senderRecruiterLower',
                        totalInterviewsSent: { $sum: 1 },
                        completed: {
                            $sum: { $cond: [{ $in: [{ $toLower: { $ifNull: ['$status', ''] } }, ['completed', 'done']] }, 1, 0] }
                        },
                        cancelled: {
                            $sum: { $cond: [{ $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'cancelled'] }, 1, 0] }
                        },
                        rescheduled: {
                            $sum: { $cond: [{ $eq: [{ $toLower: { $ifNull: ['$status', ''] } }, 'rescheduled'] }, 1, 0] }
                        },
                        notDone: {
                            $sum: { $cond: ['$isNotDone', 1, 0] }
                        },
                        rounds: { $push: '$normalizedRound' }
                    }
                },
                {
                    $project: {
                        recruiter: '$_id',
                        totalInterviewsSent: 1,
                        completed: 1,
                        cancelled: 1,
                        rescheduled: 1,
                        notDone: 1,
                        roundsDetail: '$rounds',
                        qualityScore: {
                            $subtract: [
                                { $multiply: ['$completed', 1.0] },
                                {
                                    $add: [
                                        { $multiply: ['$cancelled', 0.5] },
                                        { $multiply: ['$rescheduled', 0.3] },
                                        { $multiply: ['$notDone', 1.0] }
                                    ]
                                }
                            ]
                        }
                    }
                },
                { $sort: { totalInterviewsSent: -1 } }
            );

            const stats = await this.taskCollection.aggregate(pipeline).toArray();

            // Enrich with teamLead information
            const processed = await Promise.all(stats.map(async stat => {
                const roundCounts = {};
                (stat.roundsDetail || []).forEach(r => {
                    const key = r || 'Unknown';
                    roundCounts[key] = (roundCounts[key] || 0) + 1;
                });
                delete stat.roundsDetail;

                // Lookup teamLead for this recruiter
                let teamLead = 'No Team';
                try {
                    const userRecord = await this.userCollection.findOne({
                        email: { $regex: new RegExp(`^${stat._id}$`, 'i') }
                    });
                    if (userRecord && userRecord.teamLead) {
                        teamLead = userRecord.teamLead;
                    }
                } catch (err) {
                    logger.error('Error looking up teamLead', { error: err.message, recruiter: stat._id });
                }

                return { ...stat, roundCounts, teamLead };
            }));

            res.json({ success: true, data: processed, dateRange: { start, end } });
        } catch (error) {
            logger.error('Error fetching recruiter stats', { error: error.message });
            res.status(500).json({ success: false, error: 'Failed to fetch recruiter stats' });
        }
    }

    async getExpertStats(req, res) {
        try {
            const { period, startDate, endDate, expertEmail } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);
            const user = req.user;

            const pipeline = [
                {
                    $lookup: {
                        from: 'candidateDetails',
                        let: { emailId: '$Email ID' },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$Email ID', '$$emailId'] } } },
                            { $match: { docType: { $in: [null, 'candidate'] } } },
                            { $sort: { updatedAt: -1 } },
                            { $limit: 1 }
                        ],
                        as: 'candidateDetails'
                    }
                },
                { $unwind: { path: '$candidateDetails', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        assignedExpertLower: {
                            $toLower: {
                                $cond: {
                                    if: { $ne: [{ $ifNull: ["$assignedTo", ""] }, ""] },
                                    then: "$assignedTo",
                                    else: { $ifNull: ["$candidateDetails.Expert", ""] }
                                }
                            }
                        },
                        senderRecruiterLower: { $toLower: { $ifNull: ['$sender', ''] } },
                        recruiterEmailLower: { $toLower: { $ifNull: ['$candidateDetails.Recruiter', ''] } },
                        effectiveBranch: { $toUpper: { $ifNull: ['$candidateDetails.Branch', 'UNKNOWN'] } },
                        normalizedRound: this.getRoundNormalizationLogic(),
                        interviewDate: {
                            $dateFromString: {
                                dateString: '$Date of Interview',
                                format: '%m/%d/%Y',
                                onError: null
                            }
                        }
                    }
                },
                {
                    $match: {
                        interviewDate: {
                            $gte: start,
                            $lte: end
                        }
                    }
                }
            ];

            const scopedMatch = await this.getScopedMatchForTasks(user, {
                ...(expertEmail ? { assignedExpertLower: expertEmail.toLowerCase() } : {})
            });
            pipeline.push({ $match: scopedMatch });

            pipeline.push({
                $lookup: {
                    from: 'users',
                    let: { expertEmail: '$assignedExpertLower' },
                    pipeline: [
                        { $match: { $expr: { $eq: [{ $toLower: '$email' }, '$$expertEmail'] } } },
                        { $match: { role: 'user' } },
                        { $limit: 1 }
                    ],
                    as: 'expertUserInfo'
                }
            });
            pipeline.push({
                $match: {
                    expertUserInfo: { $ne: [] }
                }
            });

            pipeline.push({
                $match: {
                    assignedExpertLower: { $not: { $regex: /\.co\.uk$/i } }
                }
            });

            pipeline.push(
                {
                    $group: {
                        _id: '$assignedExpertLower',
                        totalTasks: { $sum: 1 },
                        completedTasks: {
                            $sum: { $cond: [{ $in: [{ $toLower: { $ifNull: ['$status', ''] } }, ['completed', 'done']] }, 1, 0] }
                        },
                        pendingTasks: {
                            $sum: { $cond: [{ $in: [{ $toLower: { $ifNull: ['$status', ''] } }, ['pending', 'assigned', 'acknowledged']] }, 1, 0] }
                        },
                        acknowledged: {
                            $sum: { $cond: [{ $eq: ['$assignment.acknowledged', true] }, 1, 0] }
                        },
                        roundsConducted: { $push: '$normalizedRound' }
                    }
                },
                {
                    $project: {
                        expert: '$_id',
                        totalTasks: 1,
                        completedTasks: 1,
                        activeBucket: '$pendingTasks',
                        acknowledgedShare: {
                            $cond: [
                                { $eq: ['$totalTasks', 0] },
                                0,
                                { $multiply: [{ $divide: ['$acknowledged', '$totalTasks'] }, 100] }
                            ]
                        },
                        rounds: '$roundsConducted'
                    }
                }
            );

            const stats = await this.taskCollection.aggregate(pipeline).toArray();

            const processed = stats.map(stat => {
                const roundCounts = {};
                (stat.rounds || []).forEach(r => {
                    const key = r || 'Unknown';
                    roundCounts[key] = (roundCounts[key] || 0) + 1;
                });
                delete stat.rounds;
                return { ...stat, roundCounts };
            });

            res.json({ success: true, data: processed, dateRange: { start, end } });
        } catch (error) {
            logger.error('Error fetching expert stats', error);
            res.status(500).json({ success: false });
        }
    }

    async getManagementStats(req, res) {
        try {
            const { branch } = req.query;
            const user = req.user;
            const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

            let pipeline = [
                {
                    $match: {
                        status: { $regex: /^active$/i },
                        docType: { $in: [null, 'candidate'] },
                        ...(branch ? { Branch: branch } : {})
                    }
                },
                {
                    $addFields: {
                        // Fix: Normalize fields for candidate scoping
                        recruiterEmailLower: { $toLower: { $ifNull: ['$Recruiter', ''] } },
                        expertEmailLower: { $toLower: { $ifNull: ['$Expert', ''] } },
                        branchUpper: { $toUpper: { $ifNull: ['$Branch', 'UNKNOWN'] } }
                    }
                }
            ];

            // Fix: Use candidate-specific scoping instead of task scoping
            const scopedMatch = await this.getScopedMatchForCandidates(user, {});
            pipeline.push({ $match: scopedMatch });

            pipeline.push(
                {
                    $lookup: {
                        from: 'taskBody',
                        localField: 'Email ID',
                        foreignField: 'Email ID',
                        as: 'interviews'
                    }
                },
                {
                    $addFields: {
                        interviewsLast30Days: {
                            $filter: {
                                input: '$interviews',
                                as: 'interview',
                                cond: {
                                    $gte: [
                                        { $dateFromString: { dateString: '$$interview.Date of Interview', format: '%m/%d/%Y', onError: new Date(0) } },
                                        thirtyDaysAgo
                                    ]
                                }
                            }
                        }
                    }
                },
                {
                    $project: {
                        'Candidate Name': 1,
                        'Branch': 1,
                        'Recruiter': 1,
                        'Email ID': 1,
                        totalInterviews: { $size: '$interviews' },
                        recentInterviews: { $size: '$interviewsLast30Days' },
                        lastInterviewDate: {
                            $max: {
                                $map: {
                                    input: '$interviews',
                                    as: 'iv',
                                    in: { $dateFromString: { dateString: '$$iv.Date of Interview', format: '%m/%d/%Y', onError: new Date(0) } }
                                }
                            }
                        }
                    }
                },
                { $match: { recentInterviews: { $lte: 3 } } },
                { $sort: { lastInterviewDate: 1 } },
                { $limit: 100 }
            );

            const report = await this.candidateCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data: report });
        } catch (error) {
            logger.error('Error fetching management stats', error);
            res.status(500).json({ success: false, error: 'Failed to fetch management stats' });
        }
    }

    async getStatsDrilldown(req, res) {
        try {
            const { type, email, period, dateBasis, startDate } = req.query;
            const user = req.user;

            // Re-use logic to scope access
            // For Recruiter drilldown: filter by ownerRecruiter or senderRecruiter = email?
            // "Recruiter Should Only See His Active Candidate" -> Use standard scoping.
            // If the user clicks on a bar for "Specific Recruiter", they want tasks for THAT recruiter.
            // But we must verify if the requesting "user" is allowed to see data for "email".
            // A recruiter can only see their own. A manager can see their team.
            // The `getScopedMatchStage` mostly handles "my scope". 
            // If I am Admin, I can see "email". If I am Recruiter X, I can only see specific tasks.

            const pipeline = [];

            // 1. Role-based Visibility Scope (Who am I?)
            const visibilityMatch = await this.getScopedMatchStage(user, {});
            pipeline.push({ $match: visibilityMatch });

            // 2. Target Filter (Who/What did I click on?)
            if (type === 'recruiter') {
                // The 'email' param is the Recruiter's name or email from the chart logic.
                // In `RecruiterAnalytics`, we might be passing the NAME. We need to match it.
                // Or we might match both sender/owner recruiters for this target.
                // If the chart grouped by "Recruiter Name", filtering might be via $or or regex.
                // Let's assume 'email' is the identifier passed.
                if (email) {
                    const fuzzyName = this.userModel.formatDisplayNameFromEmail(email);
                    pipeline.push({
                        $match: {
                            $or: [
                                { senderRecruiter: { $regex: email, $options: 'i' } },
                                { ownerRecruiter: { $regex: fuzzyName, $options: 'i' } }, // Match name
                                { ownerRecruiter: { $regex: email, $options: 'i' } }      // Match email if raw
                            ]
                        }
                    });
                }
            } else if (type === 'expert') {
                if (email) {
                    pipeline.push({
                        $match: {
                            assignedExpert: { $regex: email, $options: 'i' }
                        }
                    });
                }
            } else if (type === 'candidate') {
                if (email) {
                    pipeline.push({
                        $match: {
                            $or: [
                                { 'Candidate Name': { $regex: email, $options: 'i' } },
                                { 'Candidate Email': { $regex: email, $options: 'i' } }
                            ]
                        }
                    });
                }
            }

            // 3. Date Range
            let { start, end } = this.calculateDateRange(period, startDate);
            const effectiveDateField = dateBasis === 'received' ? 'receivedDateTime' : 'Date of Interview';

            // Adjust for taskModel logic/format
            // taskModel usually handles strings for "Date of Interview"
            const dateMatch = {};
            if (effectiveDateField === 'receivedDateTime') {
                dateMatch.receivedDateTime = {
                    $gte: start.toISOString(),
                    $lte: end.toISOString()
                };
            } else {
                dateMatch['Date of Interview'] = {
                    $gte: moment(start).format('MM/DD/YYYY'),
                    $lte: moment(end).format('MM/DD/YYYY')
                };
            }
            pipeline.push({ $match: dateMatch });

            // 4. Fields Projection (User requested specific fields)
            pipeline.push({
                $project: {
                    'Candidate Name': 1,
                    'Date of Interview': 1,
                    'Start Time Of Interview': 1, // Requested
                    'Interview Round': 1,
                    'status': 1,
                    'Actual Round': 1,           // Requested (check field name? usually "interviewRound" or "round" or "Actual Round")
                    'Job Title': 1,
                    'End Client': 1
                }
            });

            // Limit
            pipeline.push({ $limit: 100 });

            const tasks = await this.taskCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data: tasks });

        } catch (error) {
            logger.error('Error fetching stats drilldown', error);
            res.status(500).json({ success: false, error: 'Failed to fetch drilldown' });
        }
    }
    async getRecruiterDrilldown(req, res) {
        try {
            const { period, startDate, endDate, recruiterEmail, status } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);

            const matchStage = {
                'Date of Interview': {
                    $gte: moment(start).format('MM/DD/YYYY'),
                    $lte: moment(end).format('MM/DD/YYYY')
                }
            };

            const pipeline = [
                { $match: matchStage },
                {
                    $lookup: {
                        from: 'candidateDetails',
                        localField: 'Email ID',
                        foreignField: 'Email ID',
                        as: 'candidateInfo'
                    }
                },
                { $unwind: { path: '$candidateInfo', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        senderRecruiter: { $toLower: '$sender' },
                        statusLower: { $toLower: '$status' },
                        isNotDone: {
                            $and: [
                                {
                                    $lt: [
                                        { $dateFromString: { dateString: '$Date of Interview', format: '%m/%d/%Y', onError: new Date() } },
                                        new Date()
                                    ]
                                },
                                { $not: { $in: ['$status', ['Completed', 'Done', 'Cancelled', 'Rescheduled']] } }
                            ]
                        }
                    }
                },
                {
                    $match: {
                        senderRecruiter: { $regex: recruiterEmail, $options: 'i' } // Ensure exact match logic handling in frontend/request
                    }
                }
            ];

            // Filter by status if provided
            if (status) {
                if (status === 'completed') {
                    pipeline.push({ $match: { statusLower: { $in: ['completed', 'done'] } } });
                } else if (status === 'cancelled') {
                    pipeline.push({ $match: { statusLower: 'cancelled' } });
                } else if (status === 'rescheduled') {
                    pipeline.push({ $match: { statusLower: 'rescheduled' } });
                } else if (status === 'notDone') {
                    pipeline.push({ $match: { isNotDone: true } });
                }
            }

            pipeline.push({ $limit: 100 }); // Limit results
            pipeline.push({ $project: { 'Candidate Name': 1, 'Date of Interview': 1, 'status': 1, 'Job Title': 1, 'End Client': 1, 'Interview Round': 1 } });

            const data = await this.taskCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data });
        } catch (error) {
            logger.error('Error fetching recruiter drilldown', error);
            res.status(500).json({ success: false, error: 'Failed to fetch drilldown' });
        }
    }

    async getExpertDrilldown(req, res) {
        try {
            const { period, startDate, endDate, expertEmail, status } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);

            const matchStage = {
                'Date of Interview': {
                    $gte: moment(start).format('MM/DD/YYYY'),
                    $lte: moment(end).format('MM/DD/YYYY')
                }
            };

            const pipeline = [
                { $match: matchStage },
                {
                    $lookup: {
                        from: 'candidateDetails',
                        localField: 'Email ID',
                        foreignField: 'Email ID',
                        as: 'candidateDetails'
                    }
                },
                { $unwind: { path: '$candidateDetails', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        assignedExpert: {
                            $cond: {
                                if: { $ne: [{ $ifNull: ["$assignedTo", ""] }, ""] },
                                then: "$assignedTo",
                                else: "$candidateDetails.Expert"
                            }
                        },
                        statusLower: { $toLower: '$status' }
                    }
                },
                {
                    $match: {
                        assignedExpert: { $regex: expertEmail, $options: 'i' }
                    }
                }
            ];

            if (status) {
                if (status === 'completed') {
                    pipeline.push({ $match: { statusLower: { $in: ['completed', 'done'] } } });
                } else if (status === 'pending') {
                    pipeline.push({ $match: { statusLower: { $in: ['pending', 'assigned', 'acknowledged'] } } });
                }
            }

            pipeline.push({ $limit: 100 });
            pipeline.push({ $project: { 'Candidate Name': 1, 'Date of Interview': 1, 'status': 1, 'Job Title': 1, 'assignedTo': 1 } });

            const data = await this.taskCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data });
        } catch (error) {
            logger.error('Error fetching expert drilldown', error);
            res.status(500).json({ success: false, error: 'Failed to fetch drilldown' });
        }
    }

    async getOverviewStats(req, res) {
        try {
            const { period, startDate, dateBasis } = req.query; // Added startDate/dateBasis
            const user = req.user;
            let { start, end } = this.calculateDateRange(period, startDate);

            // Scoped Candidate Counts (Total & Active)
            const candidatePipeline = [
                {
                    $match: {
                        docType: { $in: [null, 'candidate'] }
                    }
                },
                {
                    $addFields: {
                        // Fix: Use normalized fields for candidate scoping
                        recruiterEmailLower: { $toLower: { $ifNull: ['$Recruiter', ''] } },
                        expertEmailLower: { $toLower: { $ifNull: ['$Expert', ''] } },
                        branchUpper: { $toUpper: { $ifNull: ['$Branch', 'UNKNOWN'] } }
                    }
                }
            ];

            // Fix: Use candidate-specific scoping
            const candidateScopedMatch = await this.getScopedMatchForCandidates(user, {});
            candidatePipeline.push({ $match: candidateScopedMatch });

            // Total candidates (scoped)
            const totalPipeline = [...candidatePipeline, { $count: "count" }];
            const totalResult = await this.candidateCollection.aggregate(totalPipeline).toArray();
            const totalCandidates = totalResult[0]?.count || 0;

            // Active candidates (scoped)
            const activePipeline = [
                ...candidatePipeline,
                { $match: { status: { $regex: /^active$/i } } },
                { $count: "count" }
            ];
            const activeResult = await this.candidateCollection.aggregate(activePipeline).toArray();
            const activeCandidates = activeResult[0]?.count || 0;


            // Fix: Replace countDocuments with aggregation for task scoping
            const isReceivedDate = dateBasis === 'received';

            const taskBasePipeline = [
                {
                    $lookup: {
                        from: 'candidateDetails',
                        let: { emailId: '$Email ID' },
                        pipeline: [
                            { $match: { $expr: { $eq: ['$Email ID', '$$emailId'] } } },
                            { $match: { docType: { $in: [null, 'candidate'] } } },
                            { $sort: { updatedAt: -1 } },
                            { $limit: 1 }
                        ],
                        as: 'candidateInfo'
                    }
                },
                { $unwind: { path: '$candidateInfo', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        senderRecruiterLower: { $toLower: { $ifNull: ['$sender', ''] } },
                        recruiterEmailLower: { $toLower: { $ifNull: ['$candidateInfo.Recruiter', ''] } },
                        assignedExpertLower: {
                            $toLower: {
                                $cond: {
                                    if: { $ne: [{ $ifNull: ['$assignedTo', ''] }, ''] },
                                    then: '$assignedTo',
                                    else: { $ifNull: ['$candidateInfo.Expert', ''] }
                                }
                            }
                        },
                        effectiveBranch: { $toUpper: { $ifNull: ['$candidateInfo.Branch', 'UNKNOWN'] } },
                        interviewDate: {
                            $dateFromString: {
                                dateString: '$Date of Interview',
                                format: '%m/%d/%Y',
                                onError: null
                            }
                        }
                    }
                }
            ];

            // Add date filter
            const dateMatch = {};
            if (isReceivedDate) {
                dateMatch.receivedDateTime = {
                    $gte: start.toISOString(),
                    $lte: end.toISOString()
                };
            } else {
                dateMatch.interviewDate = {
                    $gte: start,
                    $lte: end
                };
            }
            taskBasePipeline.push({ $match: dateMatch });

            // Apply task scoping
            const taskScopedMatch = await this.getScopedMatchForTasks(user, {});
            taskBasePipeline.push({ $match: taskScopedMatch });

            // Total interviews
            const totalInterviewsPipeline = [...taskBasePipeline, { $count: "count" }];
            const totalInterviewsResult = await this.taskCollection.aggregate(totalInterviewsPipeline).toArray();
            const totalInterviews = totalInterviewsResult[0]?.count || 0;

            // Completed interviews
            const completedPipeline = [
                ...taskBasePipeline,
                { $match: { status: { $in: ['Completed', 'Done', 'completed', 'done'] } } },
                { $count: "count" }
            ];
            const completedResult = await this.taskCollection.aggregate(completedPipeline).toArray();
            const completedInterviews = completedResult[0]?.count || 0;

            // Pending tasks
            const pendingPipeline = [
                ...taskBasePipeline,
                { $match: { status: { $in: ['Pending', 'Assigned', 'Acknowledged', 'pending', 'assigned', 'acknowledged'] } } },
                { $count: "count" }
            ];
            const pendingResult = await this.taskCollection.aggregate(pendingPipeline).toArray();
            const pendingTasks = pendingResult[0]?.count || 0;

            res.json({
                success: true,
                data: {
                    totalCandidates,
                    activeCandidates,
                    totalInterviews,
                    completedInterviews,
                    pendingTasks
                }
            });
        } catch (error) {
            logger.error('Error fetching overview stats', error);
            res.status(500).json({ success: false, error: 'Failed to fetch overview stats' });
        }
    }

    async getManagementDrilldown(req, res) {
        try {
            const { candidateEmail } = req.query;

            if (!candidateEmail) {
                return res.status(400).json({ success: false, error: 'Candidate email required' });
            }

            const pipeline = [
                { $match: { 'Email ID': candidateEmail } },
                { $limit: 50 },
                { $project: { 'Date of Interview': 1, 'Job Title': 1, 'End Client': 1, 'Interview Round': 1, 'status': 1 } }
            ];

            const data = await this.taskCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data });
        } catch (error) {
            logger.error('Error fetching management drilldown', error);
            res.status(500).json({ success: false, error: 'Failed to fetch drilldown' });
        }
    }
}

export const dashboardController = new DashboardController();
