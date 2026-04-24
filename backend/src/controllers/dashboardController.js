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

    deriveDisplayNameFromEmail(email) {
        const local = (email || '').split('@')[0];
        const parts = local.split(/[._\s-]+/).filter(Boolean);
        if (parts.length === 0) return email || '';
        return parts
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join(' ');
    }

    /**
     * Scoping for TASK queries (taskBody collection)
     * Expects normalized fields: senderRecruiterLower, assignedExpertLower, effectiveBranch
     */
    async getScopedMatchForTasks(user, baseMatch = {}, options = {}) {
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

            if (!options.excludeSelf) {
                teamEmails.push(email);
            }

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

            logger.info('Dashboard: getRecruiterStats - Request Started', {
                endpoint: 'getRecruiterStats',
                userEmail: user?.email,
                userRole: user?.role,
                queryParams: { period, startDate, endDate, branch, recruiterEmail, dateBasis },
                dateRange: { start: start.toISOString(), end: end.toISOString() }
            });

            const isReceivedDate = dateBasis === 'received';

            // Build base pipeline (mimicking taskService pattern)
            let pipeline = [];

            // Stage 1: Initial date match (before lookup for performance)
            const dateMatch = {};
            if (isReceivedDate) {
                dateMatch.receivedDateTime = {
                    $gte: start.toISOString(),
                    $lte: end.toISOString()
                };
            } else {
                // Use $expr for Date of Interview filtering
                const dateExpr = {
                    $dateFromString: {
                        dateString: "$Date of Interview",
                        format: "%m/%d/%Y",
                        timezone: "America/New_York",
                        onError: null,
                        onNull: null
                    }
                };
                dateMatch.$expr = {
                    $and: [
                        { $gte: [dateExpr, start] },
                        { $lte: [dateExpr, end] }
                    ]
                };
            }
            pipeline.push({ $match: dateMatch });

            // Stage 2: Lookup candidateDetails
            pipeline.push(
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
                { $unwind: { path: '$candidateInfo', preserveNullAndEmptyArrays: true } }
            );

            // Stage 3: Normalize fields
            pipeline.push({
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
                    statusLower: { $toLower: { $ifNull: ['$status', ''] } },
                    normalizedRound: this.getRoundNormalizationLogic()
                }
            });

            // Stage 4: Apply scoping (visibility)
            const scopedMatch = await this.getScopedMatchForTasks(user, {
                ...(branch ? { effectiveBranch: branch.toUpperCase() } : {}),
                ...(recruiterEmail ? { senderRecruiterLower: recruiterEmail.toLowerCase() } : {})
            }, {
                excludeSelf: (user.role || '').toLowerCase() === 'mam'
            });
            pipeline.push({ $match: scopedMatch });

            logger.info('Dashboard: getRecruiterStats - After Scoped Match', {
                endpoint: 'getRecruiterStats',
                userEmail: user?.email,
                scopedMatch: JSON.stringify(scopedMatch)
            });

            // Stage 5: Facet for dual grouping (bySender and byOwner)
            pipeline.push({
                $facet: {
                    bySender: [
                        // Exclude .co.uk senders
                        { $match: { senderRecruiterLower: { $not: { $regex: /\\.co\\.uk$/i } } } },
                        {
                            $group: {
                                _id: '$senderRecruiterLower',
                                totalInterviewsSent: { $sum: 1 },
                                completed: {
                                    $sum: { $cond: [{ $in: ['$statusLower', ['completed', 'done']] }, 1, 0] }
                                },
                                cancelled: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'cancelled'] }, 1, 0] }
                                },
                                rescheduled: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'rescheduled'] }, 1, 0] }
                                },
                                assigned: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'assigned'] }, 1, 0] }
                                },
                                acknowledged: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'acknowledged'] }, 1, 0] }
                                },
                                pending: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'pending'] }, 1, 0] }
                                },
                                notDone: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'not done'] }, 1, 0] }
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
                                assigned: 1,
                                acknowledged: 1,
                                pending: 1,
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
                    ],
                    byOwner: [
                        // Exclude .co.uk owners AND umang.pandya@silverspaceinc.com
                        {
                            $match: {
                                recruiterEmailLower: {
                                    $not: { $regex: /\\.co\\.uk$/i }
                                },
                                recruiterEmailLower: { $ne: 'umang.pandya@silverspaceinc.com' }
                            }
                        },
                        {
                            $group: {
                                _id: '$recruiterEmailLower',
                                totalInterviewsSent: { $sum: 1 },
                                completed: {
                                    $sum: { $cond: [{ $in: ['$statusLower', ['completed', 'done']] }, 1, 0] }
                                },
                                cancelled: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'cancelled'] }, 1, 0] }
                                },
                                rescheduled: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'rescheduled'] }, 1, 0] }
                                },
                                assigned: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'assigned'] }, 1, 0] }
                                },
                                acknowledged: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'acknowledged'] }, 1, 0] }
                                },
                                pending: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'pending'] }, 1, 0] }
                                },
                                notDone: {
                                    $sum: { $cond: [{ $eq: ['$statusLower', 'not done'] }, 1, 0] }
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
                                assigned: 1,
                                acknowledged: 1,
                                pending: 1,
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
                    ]
                }
            });

            logger.info('Dashboard: getRecruiterStats - Pipeline Before Execution', {
                endpoint: 'getRecruiterStats',
                userEmail: user?.email,
                pipelineStages: pipeline.length,
                fullPipeline: JSON.stringify(pipeline)
            });

            const results = await this.taskCollection.aggregate(pipeline).toArray();
            const facetResult = results[0] || { bySender: [], byOwner: [] };

            // Enrich both arrays with teamLead and round counts
            const enrichStats = async (stats) => {
                return Promise.all(stats.map(async stat => {
                    const roundCounts = {};
                    (stat.roundsDetail || []).forEach(r => {
                        const key = r || 'Unknown';
                        roundCounts[key] = (roundCounts[key] || 0) + 1;
                    });
                    delete stat.roundsDetail;

                    let teamLead = 'No Team';
                    try {
                        const userRecord = await this.userCollection.findOne({
                            email: { $regex: new RegExp(`^${stat._id}$`, 'i') }
                        });
                        if (userRecord) {
                            const role = (userRecord.role || '').toLowerCase();
                            if (['mlead', 'mam'].includes(role)) {
                                // MLead groups with themselves (their team)
                                // Standardize the name to match what subordinates likely use (e.g. Satyam Gupta)
                                teamLead = userRecord.name || userRecord.displayName || this.deriveDisplayNameFromEmail(userRecord.email);
                            } else if (userRecord.teamLead) {
                                // Others group with their assigned lead
                                teamLead = userRecord.teamLead;
                            }
                        }
                    } catch (err) {
                        logger.error('Error looking up teamLead', { error: err.message, recruiter: stat._id });
                    }

                    return { ...stat, roundCounts, teamLead };
                }));
            };

            const bySender = await enrichStats(facetResult.bySender);
            const byOwner = await enrichStats(facetResult.byOwner);

            logger.info('Dashboard: getRecruiterStats - Response Sent', {
                endpoint: 'getRecruiterStats',
                userEmail: user?.email,
                userRole: user?.role,
                bySenderCount: bySender.length,
                byOwnerCount: byOwner.length,
                totalInterviewsBySender: bySender.reduce((sum, r) => sum + (r.totalInterviewsSent || 0), 0),
                totalInterviewsByOwner: byOwner.reduce((sum, r) => sum + (r.totalInterviewsSent || 0), 0)
            });

            res.json({
                success: true,
                data: { bySender, byOwner },
                dateRange: { start, end }
            });
        } catch (error) {
            logger.error('Dashboard: getRecruiterStats - Error', {
                endpoint: 'getRecruiterStats',
                userEmail: req.user?.email,
                userRole: req.user?.role,
                errorMessage: error.message,
                errorStack: error.stack
            });
            res.status(500).json({ success: false, error: 'Failed to fetch recruiter stats' });
        }
    }

    async getExpertStats(req, res) {
        try {
            const { period, startDate, endDate, expertEmail, dateBasis } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);
            const user = req.user;

            // PostHog: Log request parameters
            logger.info('Dashboard: getExpertStats - Request Started', {
                endpoint: 'getExpertStats',
                userEmail: user?.email,
                userRole: user?.role,
                queryParams: { period, startDate, endDate, expertEmail, dateBasis },
                dateRange: { start: start.toISOString(), end: end.toISOString() }
            });

            const dateField = dateBasis === 'received' ? 'receivedDateTime' : 'Date of Interview';
            const isReceivedDate = dateBasis === 'received';

            let pipeline = [
                // Stage 1: Initial date match
                {
                    $match: isReceivedDate
                        ? { receivedDateTime: { $gte: start.toISOString(), $lte: end.toISOString() } }
                        : {
                            $expr: {
                                $and: [
                                    { $gte: [{ $dateFromString: { dateString: "$Date of Interview", format: "%m/%d/%Y", timezone: EST_TIMEZONE, onError: null, onNull: null } }, start] },
                                    { $lte: [{ $dateFromString: { dateString: "$Date of Interview", format: "%m/%d/%Y", timezone: EST_TIMEZONE, onError: null, onNull: null } }, end] }
                                ]
                            }
                        }
                },
                // Stage 2: Lookup and Unwind
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
                // Stage 3: Normalize Fields
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
                        statusLower: { $toLower: { $ifNull: ['$status', ''] } },
                        normalizedRound: this.getRoundNormalizationLogic()
                    }
                },
                // Stage 4: Exclude .co.uk experts
                {
                    $match: {
                        assignedExpertLower: { $not: { $regex: /\.co\.uk$/i } }
                    }
                }
            ];

            // Stage 5: Apply Scoping
            const scopedMatch = await this.getScopedMatchForTasks(user, {
                ...(expertEmail ? { assignedExpertLower: expertEmail.toLowerCase() } : {})
            });
            pipeline.push({ $match: scopedMatch });

            logger.info('Dashboard: getExpertStats - After Scoped Match', {
                endpoint: 'getExpertStats',
                userEmail: user?.email,
                scopedMatch: JSON.stringify(scopedMatch)
            });

            // Stage 6: Grouping and Metrics
            pipeline.push(
                {
                    $group: {
                        _id: '$assignedExpertLower',
                        totalTasks: { $sum: 1 },
                        completed: {
                            $sum: { $cond: [{ $in: ['$statusLower', ['completed', 'done']] }, 1, 0] }
                        },
                        cancelled: {
                            $sum: { $cond: [{ $eq: ['$statusLower', 'cancelled'] }, 1, 0] }
                        },
                        rescheduled: {
                            $sum: { $cond: [{ $eq: ['$statusLower', 'rescheduled'] }, 1, 0] }
                        },
                        assigned: {
                            $sum: { $cond: [{ $eq: ['$statusLower', 'assigned'] }, 1, 0] }
                        },
                        acknowledged: {
                            $sum: { $cond: [{ $eq: ['$statusLower', 'acknowledged'] }, 1, 0] }
                        },
                        pending: {
                            $sum: { $cond: [{ $eq: ['$statusLower', 'pending'] }, 1, 0] }
                        },
                        notDone: {
                            $sum: { $cond: [{ $eq: ['$statusLower', 'not done'] }, 1, 0] }
                        },
                        roundsConducted: { $push: '$normalizedRound' }
                    }
                },
                {
                    $project: {
                        expert: '$_id',
                        totalTasks: 1,
                        completedTasks: '$completed',
                        activeBucket: { $add: ['$pending', '$assigned', '$acknowledged'] },
                        details: {
                            completed: '$completed',
                            cancelled: '$cancelled',
                            rescheduled: '$rescheduled',
                            assigned: '$assigned',
                            acknowledged: '$acknowledged',
                            pending: '$pending',
                            notDone: '$notDone'
                        },
                        rounds: '$roundsConducted'
                    }
                },
                { $sort: { totalTasks: -1 } }
            );

            logger.info('Dashboard: getExpertStats - Pipeline Before Execution', {
                endpoint: 'getExpertStats',
                userEmail: user?.email,
                pipelineStages: pipeline.length,
                fullPipeline: JSON.stringify(pipeline)
            });

            const stats = await this.taskCollection.aggregate(pipeline).toArray();

            // Enrich with round counts
            const processed = stats.map(stat => {
                const roundCounts = {};
                (stat.rounds || []).forEach(r => {
                    const key = r || 'Unknown';
                    roundCounts[key] = (roundCounts[key] || 0) + 1;
                });
                delete stat.rounds;
                const totalTasks = stat.totalTasks || 0;
                const acknowledged = stat.details?.acknowledged ?? 0;
                const acknowledgedShare = totalTasks > 0 ? (acknowledged / totalTasks) * 100 : 0;
                return { ...stat, acknowledgedShare, roundCounts };
            });

            logger.info('Dashboard: getExpertStats - Response Sent', {
                endpoint: 'getExpertStats',
                userEmail: user?.email,
                totalExperts: processed.length,
                totalTasks: processed.reduce((sum, e) => sum + (e.totalTasks || 0), 0)
            });

            res.json({ success: true, data: processed, dateRange: { start, end } });

        } catch (error) {
            logger.error('Dashboard: getExpertStats - Error', {
                endpoint: 'getExpertStats',
                userEmail: req.user?.email,
                userRole: req.user?.role,
                errorMessage: error.message,
                errorStack: error.stack
            });
            res.status(500).json({ success: false });
        }
    }

    async getManagementStats(req, res) {
        try {
            const user = req.user;
            const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

            logger.info('Dashboard: getManagementStats - Request Started', {
                endpoint: 'getManagementStats',
                userEmail: user?.email,
                userRole: user?.role
            });

            // 1. Re-use "Branch Candidates" Scoping Logic
            // The candidateService.getCandidatesForUser method encapsulates the complex RBAC 
            // for "Who can see what candidate". We'll reuse the match stages it produces conceptually,
            // or build a similar match here. To ensure exact match with Branch Candidates view,
            // we should call the service method if it returns a query component, but it returns executed data.
            // So we reconstruct the match logic here based on role, similar to getScopedMatchForCandidates but strictly
            // following the "Branch Candidates" view visible in frontend.

            let scopeMatch = {};
            const role = (user.role || '').toLowerCase();
            const email = (user.email || '').toLowerCase();
            const normalizedEmail = email.trim().toLowerCase();

            // Resolve Scope based on Role (Logic mirror of candidateService.getCandidatesForUser)
            if (role === 'admin') {
                scopeMatch = {}; // All
            } else if (role === 'mm') {
                // MM sees their branch
                let branch = null;
                if (email.includes('tushar.ahuja')) branch = 'GGR';
                if (email.includes('aryan.mishra')) branch = 'LKN';
                if (email.includes('akash.avasthi')) branch = 'AHM';

                if (branch) {
                    scopeMatch = { Branch: branch };
                } else {
                    // Fallback to "Recruiter Mode" for MM without branch map? 
                    // Or keep empty if they should see nothing?
                    // candidateService falls back to Recruiter search or nothing.
                    // Let's assume they might act as recruiter if not mapped.
                    scopeMatch = {
                        $or: [
                            { recruiterEmailLower: normalizedEmail },
                            { 'Recruiter': { $regex: new RegExp(email, 'i') } } // Legacy match
                        ]
                    };
                }
            } else if (['mam', 'mlead', 'lead', 'am'].includes(role)) {
                // Hierarchical View
                const teamEmails = userModel.getTeamEmails(email, role, user.teamLead);
                // Include Self
                teamEmails.push(normalizedEmail);

                // For Lead/AM (Experts), they see assignedExpert.
                // For MAM/MLead (Recruitment), they see Recruiter.
                // The "Branch Candidates" view typically shows Recruiting hierarchy. 
                // However, Lead/AM also use this view.

                if (role === 'lead' || role === 'am') {
                    // EXPERT SIDE HIERARCHY
                    // They see candidates assigned to them or their team.
                    scopeMatch = {
                        $or: [
                            { expertEmailLower: { $in: teamEmails } },
                            { assignedExpert: { $regex: new RegExp(teamEmails.join('|'), 'i') } }
                        ]
                    };
                } else {
                    // RECRUITER SIDE HIERARCHY (MAM/MLEAD)
                    scopeMatch = {
                        $or: [
                            { recruiterEmailLower: { $in: teamEmails } },
                            { Recruiter: { $regex: new RegExp(teamEmails.join('|'), 'i') } }
                        ]
                    };
                }
            } else if (role === 'recruiter') {
                scopeMatch = {
                    $or: [
                        { recruiterEmailLower: normalizedEmail },
                        { Recruiter: { $regex: new RegExp(email, 'i') } }
                    ]
                };
            } else if (role === 'user' || role === 'expert') {
                scopeMatch = {
                    $or: [
                        { expertEmailLower: normalizedEmail },
                        { Expert: { $regex: new RegExp(email, 'i') } }
                    ]
                };
            }

            const pipeline = [
                {
                    $addFields: {
                        recruiterEmailLower: { $toLower: { $ifNull: ['$Recruiter', ''] } },
                        expertEmailLower: { $toLower: { $ifNull: ['$Expert', ''] } },
                        candidateEmailLower: { $toLower: { $ifNull: ['$Email ID', ''] } },
                        statusLower: { $toLower: { $ifNull: ['$status', ''] } }
                    }
                },
                {
                    $match: {
                        // 1. Status Active
                        statusLower: 'active',
                        // 2. Exclude specific emails
                        candidateEmailLower: {
                            $not: {
                                $regex: /@.*\.co\.uk$|umang\.pandya@silverspaceinc\.com/i
                            }
                        },
                        // 3. Apply Role Scope
                        ...scopeMatch,
                        // 4. Exclude specific Recruiter
                        recruiterEmailLower: { $ne: 'umang.pandya@silverspaceinc.com' }
                    }
                },
                // Lookup Interviews (TaskBody)
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
                        recentInterviews: {
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
                // Filter: "At Risk" definition
                // 1. Last Interview > 30 days ago (or never)
                // 2. Total Interviews <= 3
                {
                    $project: {
                        'Candidate Name': 1,
                        'Email ID': 1,
                        'Branch': 1,
                        'Recruiter': 1,
                        totalInterviews: { $size: '$interviews' },
                        recentInterviews: { $size: '$recentInterviews' }, // Keep for reference
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
                {
                    $match: {
                        $and: [
                            { totalInterviews: { $lte: 3 } },
                            {
                                $or: [
                                    { lastInterviewDate: { $lt: thirtyDaysAgo } },
                                    { lastInterviewDate: null }, // Never interviewed
                                    { lastInterviewDate: { $eq: new Date(0) } } // Parse error fallback
                                ]
                            }
                        ]
                    }
                },
                { $sort: { lastInterviewDate: 1 } }, // Oldest activity first (or nulls)
                { $limit: 100 }
            ];

            const report = await this.candidateCollection.aggregate(pipeline).toArray();

            res.json({ success: true, data: report });

        } catch (error) {
            logger.error('Dashboard: getManagementStats - Error', {
                endpoint: 'getManagementStats',
                error: error.message
            });
            res.status(500).json({ success: false, error: 'Failed to fetch management stats' });
        }
    }

    async getStatsDrilldown(req, res) {
        try {
            const { type, email, period, dateBasis, startDate } = req.query;
            const user = req.user;

            // PostHog: Log request
            logger.info('Dashboard: getStatsDrilldown - Request Started', {
                endpoint: 'getStatsDrilldown',
                userEmail: user?.email,
                queryParams: { type, email, period, dateBasis, startDate }
            });

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
                    const safeEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const fuzzyName = this.userModel.formatDisplayNameFromEmail(email);
                    const safeName = fuzzyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    pipeline.push({
                        $match: {
                            $or: [
                                { senderRecruiter: { $regex: safeEmail, $options: 'i' } },
                                { ownerRecruiter: { $regex: safeName, $options: 'i' } },
                                { ownerRecruiter: { $regex: safeEmail, $options: 'i' } }
                            ]
                        }
                    });
                }
            } else if (type === 'expert') {
                if (email) {
                    const safeEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    pipeline.push({
                        $match: {
                            assignedExpert: { $regex: safeEmail, $options: 'i' }
                        }
                    });
                }
            } else if (type === 'candidate') {
                if (email) {
                    const safeEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    pipeline.push({
                        $match: {
                            $or: [
                                { 'Candidate Name': { $regex: safeEmail, $options: 'i' } },
                                { 'Candidate Email': { $regex: safeEmail, $options: 'i' } }
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

            // PostHog: Log the complete pipeline before execution
            logger.info('Dashboard: getStatsDrilldown - Pipeline Before Execution', {
                endpoint: 'getStatsDrilldown',
                userEmail: user?.email,
                fullPipeline: JSON.stringify(pipeline),
                message: 'About to execute MongoDB aggregation'
            });

            const tasks = await this.taskCollection.aggregate(pipeline).toArray();

            // PostHog: Log response
            logger.info('Dashboard: getStatsDrilldown - Response Sent', {
                endpoint: 'getStatsDrilldown',
                userEmail: user?.email,
                recordCount: tasks.length,
                type,
                targetEmail: email
            });

            res.json({ success: true, data: tasks });

        } catch (error) {
            logger.error('Error fetching stats drilldown', error);
            res.status(500).json({ success: false, error: 'Failed to fetch drilldown' });
        }
    }
    async getRecruiterDrilldown(req, res) {
        try {
            const { period, startDate, endDate, recruiterEmail, status, interviewRound, actualRound, dateBasis, viewMode } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);

            // PostHog: Log request
            logger.info('Dashboard: getRecruiterDrilldown - Request Started', {
                endpoint: 'getRecruiterDrilldown',
                userEmail: req.user?.email,
                queryParams: { period, startDate, endDate, recruiterEmail, status, interviewRound, actualRound, dateBasis, viewMode }
            });

            const isReceivedDate = dateBasis === 'received';
            const dateMatch = isReceivedDate
                ? {
                    receivedDateTime: {
                        $gte: start.toISOString(),
                        $lte: end.toISOString()
                    }
                }
                : {
                    $expr: {
                        $and: [
                            {
                                $gte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$Date of Interview",
                                            format: "%m/%d/%Y",
                                            timezone: EST_TIMEZONE,
                                            onError: null,
                                            onNull: null
                                        }
                                    },
                                    start
                                ]
                            },
                            {
                                $lte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$Date of Interview",
                                            format: "%m/%d/%Y",
                                            timezone: EST_TIMEZONE,
                                            onError: null,
                                            onNull: null
                                        }
                                    },
                                    end
                                ]
                            }
                        ]
                    }
                };

            const pipeline = [
                { $match: dateMatch },
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
                        senderRecruiterLower: { $toLower: { $ifNull: ['$sender', ''] } },
                        recruiterEmailLower: { $toLower: { $ifNull: ['$candidateInfo.Recruiter', ''] } },
                        statusLower: { $toLower: { $ifNull: ['$status', ''] } },
                        interviewRoundLower: { $toLower: { $ifNull: ['$Interview Round', ''] } },
                        actualRoundResolved: { $ifNull: ['$actualRound', '$Actual Round'] },
                        actualRoundLower: {
                            $toLower: {
                                $ifNull: [
                                    { $ifNull: ['$actualRound', '$Actual Round'] },
                                    ''
                                ]
                            }
                        },
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
            ];

            if (recruiterEmail) {
                const normalizedRecruiter = recruiterEmail.toLowerCase().trim();
                if (viewMode === 'owner') {
                    pipeline.push({ $match: { recruiterEmailLower: normalizedRecruiter } });
                } else if (viewMode === 'sender') {
                    pipeline.push({ $match: { senderRecruiterLower: normalizedRecruiter } });
                } else {
                    pipeline.push({
                        $match: {
                            $or: [
                                { senderRecruiterLower: normalizedRecruiter },
                                { recruiterEmailLower: normalizedRecruiter }
                            ]
                        }
                    });
                }
            }

            // Filter by status if provided
            if (status) {
                const normalizedStatus = status.toLowerCase();
                if (normalizedStatus === 'completed') {
                    pipeline.push({ $match: { statusLower: { $in: ['completed', 'done'] } } });
                } else if (normalizedStatus === 'cancelled') {
                    pipeline.push({ $match: { statusLower: 'cancelled' } });
                } else if (normalizedStatus === 'rescheduled') {
                    pipeline.push({ $match: { statusLower: 'rescheduled' } });
                } else if (normalizedStatus === 'notdone' || normalizedStatus === 'not done') {
                    pipeline.push({ $match: { isNotDone: true } });
                } else {
                    pipeline.push({ $match: { statusLower: normalizedStatus } });
                }
            }

            if (interviewRound) {
                pipeline.push({ $match: { interviewRoundLower: interviewRound.toLowerCase() } });
            }

            if (actualRound) {
                pipeline.push({ $match: { actualRoundLower: actualRound.toLowerCase() } });
            }

            pipeline.push({ $limit: 100 }); // Limit results
            pipeline.push({
                $project: {
                    _id: 1,
                    'Candidate Name': 1,
                    'Email ID': 1,
                    'Date of Interview': 1,
                    'Start Time Of Interview': 1,
                    'End Time Of Interview': 1,
                    'status': 1,
                    'Job Title': 1,
                    'End Client': 1,
                    'Interview Round': 1,
                    'Actual Round': '$actualRoundResolved',
                    'Vendor': 1,
                    'sender': 1,
                    'assignedTo': 1,
                    'assignedExpert': 1,
                    'assignedAt': 1,
                    'suggestions': 1,
                }
            });

            // PostHog: Log the complete pipeline before execution
            logger.info('Dashboard: getRecruiterDrilldown - Pipeline Before Execution', {
                endpoint: 'getRecruiterDrilldown',
                userEmail: req.user?.email,
                fullPipeline: JSON.stringify(pipeline),
                message: 'About to execute MongoDB aggregation'
            });

            const data = await this.taskCollection.aggregate(pipeline).toArray();

            // Batch-lookup candidateId from candidateDetails by Email ID
            const emails = [...new Set(data.map(t => t['Email ID']).filter(Boolean))];
            const candidateCol = database.getCollection('candidateDetails');
            const candidateDocs = (candidateCol && emails.length)
                ? await candidateCol.find({ 'Email ID': { $in: emails } }, { projection: { _id: 1, 'Email ID': 1 } }).toArray()
                : [];
            const emailToId = Object.fromEntries(candidateDocs.map(d => [d['Email ID'], d._id.toString()]));
            const enriched = data.map(t => ({ ...t, candidateId: emailToId[t['Email ID']] || null }));

            // PostHog: Log response
            logger.info('Dashboard: getRecruiterDrilldown - Response Sent', {
                endpoint: 'getRecruiterDrilldown',
                userEmail: req.user?.email,
                recordCount: enriched.length,
                recruiterEmail,
                status
            });

            res.json({ success: true, data: enriched });

        } catch (error) {
            logger.error('Error fetching recruiter drilldown', error);
            res.status(500).json({ success: false, error: 'Failed to fetch drilldown' });
        }
    }

    async getExpertDrilldown(req, res) {
        try {
            const { period, startDate, endDate, expertEmail, status, interviewRound, actualRound, dateBasis } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);

            // PostHog: Log request
            logger.info('Dashboard: getExpertDrilldown - Request Started', {
                endpoint: 'getExpertDrilldown',
                userEmail: req.user?.email,
                queryParams: { period, startDate, endDate, expertEmail, status, interviewRound, actualRound, dateBasis }
            });

            const isReceivedDate = dateBasis === 'received';
            const dateMatch = isReceivedDate
                ? {
                    receivedDateTime: {
                        $gte: start.toISOString(),
                        $lte: end.toISOString()
                    }
                }
                : {
                    $expr: {
                        $and: [
                            {
                                $gte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$Date of Interview",
                                            format: "%m/%d/%Y",
                                            timezone: EST_TIMEZONE,
                                            onError: null,
                                            onNull: null
                                        }
                                    },
                                    start
                                ]
                            },
                            {
                                $lte: [
                                    {
                                        $dateFromString: {
                                            dateString: "$Date of Interview",
                                            format: "%m/%d/%Y",
                                            timezone: EST_TIMEZONE,
                                            onError: null,
                                            onNull: null
                                        }
                                    },
                                    end
                                ]
                            }
                        ]
                    }
                };

            const pipeline = [
                { $match: dateMatch },
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
                        assignedExpertLower: {
                            $toLower: {
                                $cond: {
                                    if: { $ne: [{ $ifNull: ["$assignedTo", ""] }, ""] },
                                    then: "$assignedTo",
                                    else: "$candidateDetails.Expert"
                                }
                            }
                        },
                        statusLower: { $toLower: { $ifNull: ['$status', ''] } },
                        interviewRoundLower: { $toLower: { $ifNull: ['$Interview Round', ''] } },
                        actualRoundResolved: { $ifNull: ['$actualRound', '$Actual Round'] },
                        actualRoundLower: {
                            $toLower: {
                                $ifNull: [
                                    { $ifNull: ['$actualRound', '$Actual Round'] },
                                    ''
                                ]
                            }
                        }
                    }
                },
                {
                    $match: {
                        assignedExpertLower: (expertEmail || '').toLowerCase().trim()
                    }
                }
            ];

            if (status) {
                const normalizedStatus = status.toLowerCase();
                if (normalizedStatus === 'completed') {
                    pipeline.push({ $match: { statusLower: { $in: ['completed', 'done'] } } });
                } else {
                    pipeline.push({ $match: { statusLower: normalizedStatus } });
                }
            }

            if (interviewRound) {
                pipeline.push({ $match: { interviewRoundLower: interviewRound.toLowerCase() } });
            }

            if (actualRound) {
                pipeline.push({ $match: { actualRoundLower: actualRound.toLowerCase() } });
            }

            pipeline.push({ $limit: 100 });
            pipeline.push({
                $project: {
                    _id: 1,
                    'Candidate Name': 1,
                    'Email ID': 1,
                    'Date of Interview': 1,
                    'Start Time Of Interview': 1,
                    'End Time Of Interview': 1,
                    'status': 1,
                    'Job Title': 1,
                    'End Client': 1,
                    'Interview Round': 1,
                    'Actual Round': '$actualRoundResolved',
                    'Vendor': 1,
                    'sender': 1,
                    'assignedTo': 1,
                    'assignedExpert': 1,
                    'assignedAt': 1,
                    'suggestions': 1,
                }
            });

            // PostHog: Log the complete pipeline before execution
            logger.info('Dashboard: getExpertDrilldown - Pipeline Before Execution', {
                endpoint: 'getExpertDrilldown',
                userEmail: req.user?.email,
                fullPipeline: JSON.stringify(pipeline),
                message: 'About to execute MongoDB aggregation'
            });

            const data = await this.taskCollection.aggregate(pipeline).toArray();

            // Batch-lookup candidateId
            const emails = [...new Set(data.map(t => t['Email ID']).filter(Boolean))];
            const candidateCol = database.getCollection('candidateDetails');
            const candidateDocs = (candidateCol && emails.length)
                ? await candidateCol.find({ 'Email ID': { $in: emails } }, { projection: { _id: 1, 'Email ID': 1 } }).toArray()
                : [];
            const emailToId = Object.fromEntries(candidateDocs.map(d => [d['Email ID'], d._id.toString()]));
            const enriched = data.map(t => ({ ...t, candidateId: emailToId[t['Email ID']] || null }));

            // PostHog: Log response
            logger.info('Dashboard: getExpertDrilldown - Response Sent', {
                endpoint: 'getExpertDrilldown',
                userEmail: req.user?.email,
                recordCount: enriched.length,
                expertEmail,
                status
            });

            res.json({ success: true, data: enriched });

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

            // PostHog: Log request parameters
            logger.info('Dashboard: getOverviewStats - Request Started', {
                endpoint: 'getOverviewStats',
                userEmail: user?.email,
                userRole: user?.role,
                queryParams: { period, startDate, dateBasis },
                dateRange: { start: start.toISOString(), end: end.toISOString() }
            });

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

            // PostHog: Log candidate pipeline
            logger.info('Dashboard: getOverviewStats - Candidate Pipeline', {
                endpoint: 'getOverviewStats',
                userEmail: user?.email,
                fullPipeline: JSON.stringify(totalPipeline),
                message: 'Candidate aggregation pipeline'
            });

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

            // PostHog: Log task pipeline
            logger.info('Dashboard: getOverviewStats - Task Pipeline', {
                endpoint: 'getOverviewStats',
                userEmail: user?.email,
                fullPipeline: JSON.stringify(totalInterviewsPipeline),
                message: 'Task aggregation pipeline'
            });

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

            // PostHog: Log final output
            logger.info('Dashboard: getOverviewStats - Response Sent', {
                endpoint: 'getOverviewStats',
                userEmail: user?.email,
                userRole: user?.role,
                results: {
                    totalCandidates,
                    activeCandidates,
                    totalInterviews,
                    completedInterviews,
                    pendingTasks
                },
                candidateScopedMatch: candidateScopedMatch,
                taskScopedMatch: taskScopedMatch
            });

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
            logger.error('Dashboard: getOverviewStats - Error', {
                endpoint: 'getOverviewStats',
                userEmail: req.user?.email,
                userRole: req.user?.role,
                errorMessage: error.message,
                errorStack: error.stack
            });
            res.status(500).json({ success: false, error: 'Failed to fetch overview stats' });
        }
    }

    async getManagementDrilldown(req, res) {
        try {
            const { candidateEmail } = req.query;

            // PostHog: Log request
            logger.info('Dashboard: getManagementDrilldown - Request Started', {
                endpoint: 'getManagementDrilldown',
                userEmail: req.user?.email,
                queryParams: { candidateEmail }
            });

            if (!candidateEmail) {
                return res.status(400).json({ success: false, error: 'Candidate email required' });
            }

            const pipeline = [
                { $match: { 'Email ID': candidateEmail } },
                { $limit: 50 },
                { $project: { 'Date of Interview': 1, 'Job Title': 1, 'End Client': 1, 'Interview Round': 1, 'status': 1 } }
            ];

            // PostHog: Log the complete pipeline before execution
            logger.info('Dashboard: getManagementDrilldown - Pipeline Before Execution', {
                endpoint: 'getManagementDrilldown',
                userEmail: req.user?.email,
                fullPipeline: JSON.stringify(pipeline),
                message: 'About to execute MongoDB aggregation'
            });

            const data = await this.taskCollection.aggregate(pipeline).toArray();

            // PostHog: Log response
            logger.info('Dashboard: getManagementDrilldown - Response Sent', {
                endpoint: 'getManagementDrilldown',
                userEmail: req.user?.email,
                recordCount: data.length,
                candidateEmail
            });

            res.json({ success: true, data });
        } catch (error) {
            logger.error('Error fetching management drilldown', error);
            res.status(500).json({ success: false, error: 'Failed to fetch drilldown' });
        }
    }
}

export const dashboardController = new DashboardController();
