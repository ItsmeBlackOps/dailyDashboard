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

    async getRecruiterStats(req, res) {
        try {
            const { period, startDate, endDate, branch, recruiterEmail } = req.query;
            let { start, end } = this.calculateDateRange(period, startDate, endDate);

            // Match stage for Tasks
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
                        localField: 'Candidate Name',
                        foreignField: 'Candidate Name',
                        as: 'candidateInfo'
                    }
                },
                { $unwind: { path: '$candidateInfo', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        finalRound: { $ifNull: ['$actualRound', '$Interview Round'] },
                        recruiterName: { $ifNull: ['$candidateInfo.Recruiter', 'Unknown'] },
                        branchName: { $ifNull: ['$candidateInfo.Branch', 'Unknown'] }
                    }
                },
                {
                    $match: {
                        ...(branch ? { branchName: branch } : {}),
                        ...(recruiterEmail ? { recruiterName: { $regex: recruiterEmail, $options: 'i' } } : {})
                    }
                },
                {
                    $group: {
                        _id: { recruiter: '$recruiterName', status: '$status' },
                        count: { $sum: 1 },
                        rounds: { $push: '$finalRound' }
                    }
                },
                {
                    $group: {
                        _id: '$_id.recruiter',
                        totalInterviews: { $sum: '$count' },
                        statusBreakdown: {
                            $push: {
                                status: '$_id.status',
                                count: '$count'
                            }
                        },
                        roundsDetail: { $push: '$rounds' }
                    }
                }
            ];

            const stats = await this.taskCollection.aggregate(pipeline).toArray();
            res.json({ success: true, data: stats, dateRange: { start, end } });
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
                        localField: 'Candidate Name',
                        foreignField: 'Candidate Name',
                        as: 'candidateDetails'
                    }
                },
                { $unwind: { path: '$candidateDetails', preserveNullAndEmptyArrays: true } },
                {
                    $addFields: {
                        assignedExpert: { $ifNull: ['$assignedTo', '$candidateDetails.Expert'] },
                        finalRound: { $ifNull: ['$actualRound', '$Interview Round'] }
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
                            $sum: {
                                $cond: [{
                                    $in: [{ $toLower: '$status' }, ['completed', 'done']]
                                }, 1, 0]
                            }
                        },
                        roundsConducted: { $push: '$finalRound' }
                    }
                },
                {
                    $project: {
                        expert: '$_id',
                        totalTasks: 1,
                        completedTasks: 1,
                        activeTasks: { $subtract: ['$totalTasks', '$completedTasks'] },
                        completionRate: {
                            $cond: [
                                { $eq: ['$totalTasks', 0] },
                                0,
                                { $multiply: [{ $divide: ['$completedTasks', '$totalTasks'] }, 100] }
                            ]
                        },
                        rounds: '$roundsConducted'
                    }
                }
            ];

            const stats = await this.taskCollection.aggregate(pipeline).toArray();

            // Post-process rounds in JS
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
                        localField: 'Candidate Name',
                        foreignField: 'Candidate Name',
                        as: 'interviews'
                    }
                },
                {
                    $project: {
                        'Candidate Name': 1,
                        'Branch': 1,
                        'Recruiter': 1,
                        interviewCount: { $size: '$interviews' },
                        lastInterview: { $max: '$interviews.Date of Interview' }
                    }
                },
                { $sort: { interviewCount: 1 } },
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
