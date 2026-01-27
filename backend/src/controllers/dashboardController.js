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

    async getScopedMatchStage(user, baseMatch = {}) {
        if (!user) return baseMatch;
        const role = (user.role || '').toLowerCase();
        const email = (user.email || '').toLowerCase();

        // Admin: See all
        if (role === 'admin') {
            return baseMatch;
        }

        // Recruiter: See self (Sender OR Owner)
        if (role === 'recruiter') {
            return {
                ...baseMatch,
                $or: [
                    { senderRecruiter: { $regex: email, $options: 'i' } },
                    { ownerRecruiter: { $regex: userModel.formatDisplayNameFromEmail(email), $options: 'i' } }
                ]
            };
        }

        // Expert (User): See assigned tasks
        if (role === 'user' || role === 'expert') {
            return {
                ...baseMatch,
                assignedExpert: { $regex: email, $options: 'i' }
            };
        }

        // Lead/MLead/AM: See Team + Self
        if (['lead', 'mlead', 'am', 'mam'].includes(role)) {
            let teamEmails = [];

            if (role === 'mam') {
                // MAM: Teams under him (Users where manager == MAM)
                const mamName = userModel.formatDisplayNameFromEmail(email);
                const users = await this.userCollection.find({
                    manager: { $regex: mamName, $options: 'i' }
                }).toArray();
                teamEmails = users.map(u => u.email.toLowerCase());
            } else {
                // Lead/AM: Use existing logic
                teamEmails = userModel.getTeamEmails(email, role, user.teamLead);
            }

            // Add self just in case
            teamEmails.push(email);

            const teamNames = teamEmails.map(e => userModel.formatDisplayNameFromEmail(e));

            return {
                ...baseMatch,
                $or: [
                    { senderRecruiter: { $in: teamEmails } },
                    { assignedExpert: { $in: teamEmails } },
                    { ownerRecruiter: { $in: teamNames } }
                ]
            };
        }

        // MM: Whole Branch
        if (role === 'mm') {
            const userProfile = await userModel.getUserProfileMetadata(email);
            const branch = userProfile?.metadata?.branch;

            if (branch) {
                return {
                    ...baseMatch,
                    effectiveBranch: branch
                };
            }
            return {
                ...baseMatch,
                $or: [
                    { senderRecruiter: { $regex: email, $options: 'i' } },
                    { ownerRecruiter: { $regex: userModel.formatDisplayNameFromEmail(email), $options: 'i' } }
                ]
            };
        }

        return baseMatch;
    }


    async getRecruiterStats(req, res) {
        try {
            const { period, startDate, endDate, branch, recruiterEmail, dateBasis } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);
            const user = req.user;

            const dateField = dateBasis === 'received' ? 'source.receivedDateTime' : 'Date of Interview';
            const isStringDate = dateField === 'Date of Interview';

            const matchStage = {};
            if (isStringDate) {
                matchStage[dateField] = {
                    $gte: moment(start).format('MM/DD/YYYY'),
                    $lte: moment(end).format('MM/DD/YYYY')
                };
            } else {
                matchStage[dateField] = { $gte: start, $lte: end };
            }

            let pipeline = [
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
                        normalizedRound: this.getRoundNormalizationLogic(),
                        effectiveBranch: { $ifNull: ['$candidateInfo.Branch', 'Unknown'] },
                        senderRecruiter: { $toLower: '$sender' },
                        ownerRecruiter: '$candidateInfo.Recruiter',

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
                }
            ];

            const scopedMatch = await this.getScopedMatchStage(user, {
                ...(branch ? { effectiveBranch: branch } : {}),
                ...(recruiterEmail ? { senderRecruiter: { $regex: recruiterEmail, $options: 'i' } } : {})
            });

            pipeline.push({ $match: scopedMatch });

            pipeline.push({
                $group: {
                    _id: '$senderRecruiter',
                    totalInterviewsSent: { $sum: 1 },
                    completed: {
                        $sum: { $cond: [{ $in: [{ $toLower: '$status' }, ['completed', 'done']] }, 1, 0] }
                    },
                    cancelled: {
                        $sum: { $cond: [{ $eq: [{ $toLower: '$status' }, 'cancelled'] }, 1, 0] }
                    },
                    rescheduled: {
                        $sum: { $cond: [{ $eq: [{ $toLower: '$status' }, 'rescheduled'] }, 1, 0] }
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

            const processed = stats.map(stat => {
                const roundCounts = {};
                (stat.roundsDetail || []).forEach(r => {
                    const key = r || 'Unknown';
                    roundCounts[key] = (roundCounts[key] || 0) + 1;
                });
                delete stat.roundsDetail;
                return { ...stat, roundCounts };
            });

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
                        assignedExpert: { $ifNull: ['$assignedTo', '$candidateDetails.Expert'] },
                        senderRecruiter: { $toLower: '$sender' },
                        ownerRecruiter: '$candidateDetails.Recruiter',
                        normalizedRound: this.getRoundNormalizationLogic()
                    }
                }
            ];

            const scopedMatch = await this.getScopedMatchStage(user, {
                ...(expertEmail ? { assignedExpert: { $regex: expertEmail, $options: 'i' } } : {})
            });
            pipeline.push({ $match: scopedMatch });

            pipeline.push({
                $group: {
                    _id: '$assignedExpert',
                    totalTasks: { $sum: 1 },
                    completedTasks: {
                        $sum: { $cond: [{ $in: [{ $toLower: '$status' }, ['completed', 'done']] }, 1, 0] }
                    },
                    pendingTasks: {
                        $sum: { $cond: [{ $in: [{ $toLower: '$status' }, ['pending', 'assigned', 'acknowledged']] }, 1, 0] }
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
                        status: 'Active',
                        docType: { $in: [null, 'candidate'] },
                        ...(branch ? { Branch: branch } : {})
                    }
                },
                {
                    $addFields: {
                        ownerRecruiter: '$Recruiter',
                        effectiveBranch: '$Branch'
                    }
                }
            ];

            const scopedMatch = await this.getScopedMatchStage(user, {});
            // Note: As analyzed before, we apply this with the understanding that we are filtering on Candidate fields (ownerRecruiter)
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
                { $match: { recentInterviews: { $lt: 1 } } },
                { $sort: { lastInterviewDate: 1 } },
                { $limit: 100 }
            );

            const report = await this.candidateCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data: report });
        } catch (error) {
            logger.error('Error fetching management stats', error);
            res.status(500).json({ success: false });
        }
    }
}

export const dashboardController = new DashboardController();
