import { database } from '../config/database.js';
import { logger } from '../utils/logger.js';
import moment from 'moment-timezone';

const EST_TIMEZONE = 'America/New_York';

export class DashboardController {
    constructor() {
        this.taskCollection = database.getCollection('taskBody');
        this.candidateCollection = database.getCollection('candidateDetails');
        this.userCollection = database.getCollection('users');
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

    // Helper to normalize Round Logic: actualRound > Interview Round 
    // And "Loop X" -> "Loop"
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

    async getRecruiterStats(req, res) {
        try {
            const { period, startDate, endDate, branch, recruiterEmail, dateBasis } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);

            // Determine Date Field: 'Date of Interview' or 'source.receivedDateTime'
            // Default to 'Date of Interview' for Activity trends
            const dateField = dateBasis === 'received' ? 'source.receivedDateTime' : 'Date of Interview'; // Note: Date of Interview is string "MM/DD/YYYY" or similar in DB usually?

            // If we use Date of Interview (string), we must match string format "MM/DD/YYYY"
            // If we use receivedDateTime (ISO Date), we match Date objects
            const isStringDate = dateField === 'Date of Interview';

            const matchStage = {};
            if (isStringDate) {
                // This rough string match assumes inclusive range
                // Better: Filter in projection or convert strings to dates
                // For now, let's allow fetching by regex or assume exact date for daily? 
                // Actually, let's use a $expr with $dateFromString if possible, or simple "MM/DD/YYYY" string gen
                // Simpler approach for now:
                matchStage[dateField] = {
                    $gte: moment(start).format('MM/DD/YYYY'),
                    $lte: moment(end).format('MM/DD/YYYY')
                };
            } else {
                matchStage[dateField] = { $gte: start, $lte: end };
            }

            const pipeline = [
                { $match: matchStage },
                // Join CandidateDetails for Branch & Recruiter Owner info
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
                        // "Interviews they sent" = TaskBody.sender
                        senderRecruiter: '$sender', // Recruiter who SENT the interview
                        ownerRecruiter: '$candidateInfo.Recruiter', // Recruiter who OWNS the candidate

                        // "Not Done" Logic: Past End Time & Not Completed/Cancelled
                        isNotDone: {
                            $and: [
                                {
                                    $lt: [
                                        // Parse End Time... Assuming 'Date of Interview' + 'End Time Of Interview' 
                                        // This is expensive in aggregation. Let's simplify: 
                                        // If Status not in [Completed, Cancelled] AND Date < Today
                                        // We ignore time for now for performance unless strictly needed
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
                        ...(branch ? { effectiveBranch: branch } : {}),
                        ...(recruiterEmail ? { senderRecruiter: { $regex: recruiterEmail, $options: 'i' } } : {})
                    }
                },
                {
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
                // Calculate Score: (Completed * 1.0) − (Cancelled * 0.5) − (Rescheduled * 0.3) − (NotDone * 1.0)
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
            ];

            const stats = await this.taskCollection.aggregate(pipeline).toArray();
            // Calculate Round distribution in JS to save db CPU
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
                        normalizedRound: this.getRoundNormalizationLogic()
                    }
                },
                {
                    $match: {
                        ...(expertEmail ? { assignedExpert: { $regex: expertEmail, $options: 'i' } } : {})
                    }
                },
                {
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
            ];

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
            // Logic: Stagnant Candidates
            // Active candidates with LOW interview count in last 30 days
            // Coverage Rate Logic also needed but for this endpoint let's stick to the "List" report

            const thirtyDaysAgo = moment().subtract(30, 'days').toDate();

            const pipeline = [
                {
                    $match: {
                        status: 'Active',
                        docType: { $in: [null, 'candidate'] },
                        ...(branch ? { Branch: branch } : {})
                    }
                },
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
                // Filter for "Risk": Recent interviews < 1 (i.e., 0)
                { $match: { recentInterviews: { $lt: 1 } } },
                { $sort: { lastInterviewDate: 1 } }, // Oldest interaction first (most stagnant)
                { $limit: 100 }
            ];

            const report = await this.candidateCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data: report });
        } catch (error) {
            logger.error('Error fetching management stats', error);
            res.status(500).json({ success: false });
        }
    }
}

export const dashboardController = new DashboardController();
