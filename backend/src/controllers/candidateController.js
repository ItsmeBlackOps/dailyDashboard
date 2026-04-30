import { storageService } from '../services/storageService.js';
import { resumeProfileService } from '../services/resumeProfileService.js';
import { candidateService } from '../services/candidateService.js';
import { candidateModel } from '../models/Candidate.js';
import { userModel } from '../models/User.js';
import { logger } from '../utils/logger.js';
import { database } from '../config/database.js';
import { ObjectId } from 'mongodb';

const MARKETING_ROLES = ['admin', 'mam', 'mm', 'mlead', 'recruiter'];
const MARKETING_DOMAINS = ['vizvainc.com', 'vizvaconsultancy.co.uk'];

class CandidateController {
  // Returns a MongoDB filter object scoping candidateDetails by the requesting user.
  // Uses string-based $regex + $options (same pattern as candidateModel) for driver compatibility.
  async _scopeFilter(user) {
    if (!user) return {};
    const role = (user.role || '').trim().toLowerCase();
    const email = (user.email || '').toLowerCase();
    const esc = (e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const exactRe = (e) => ({ $regex: `^${esc(e)}$`, $options: 'i' });

    if (role === 'admin') return {};

    if (role === 'recruiter') return { Recruiter: exactRe(email) };

    if (role === 'user' || role === 'expert') return { Expert: exactRe(email) };

    if (['lead', 'mlead', 'am', 'mam'].includes(role)) {
      let teamEmails = [];
      if (role === 'mam') {
        const mamName = userModel.formatDisplayNameFromEmail(email);
        const userCol = database.getCollection('users');
        if (userCol) {
          const members = await userCol.find({ manager: { $regex: mamName, $options: 'i' } }).toArray();
          teamEmails = members.map(u => u.email.toLowerCase());
        }
      } else {
        teamEmails = userModel.getTeamEmails(email, role, user.teamLead) || [];
      }
      teamEmails.push(email);
      // Build $or with one regex condition per email
      return {
        $or: [
          { Recruiter: { $in: teamEmails.map(e => new RegExp(`^${esc(e)}$`, 'i')) } },
          { Expert:    { $in: teamEmails.map(e => new RegExp(`^${esc(e)}$`, 'i')) } },
        ],
      };
    }

    if (role === 'mm') {
      const profile = await userModel.getUserProfileMetadata(email);
      let branch = profile?.metadata?.branch;
      if (email.includes('tushar.ahuja')) branch = 'GGR';
      if (email.includes('aryan.mishra')) branch = 'LKN';
      if (email.includes('akash.avasthi')) branch = 'AHM';
      if (branch) return { Branch: exactRe(branch) };
      return { Recruiter: exactRe(email) };
    }

    return {};
  }

  async uploadResume(req, res) {
    try {
      const user = req.user;

      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const normalizedRole = (user.role || '').trim().toLowerCase();
      if (!['manager', 'admin', 'mm', 'mam', 'mlead', 'recruiter'].includes(normalizedRole)) {
        return res.status(403).json({
          success: false,
          error: 'Only managers can upload resumes'
        });
      }

      const file = req.file;
      if (!file) {
        return res.status(400).json({
          success: false,
          error: 'Resume file is required'
        });
      }

      const { buffer, mimetype, originalname } = file;

      const result = await storageService.uploadResume({
        buffer,
        contentType: mimetype,
        originalName: originalname,
        uploadedBy: user.email
      });

      // Fire-and-forget: derive search profile asynchronously after upload
      if (result.resumeLink && resumeProfileService.enabled) {
        const db = database.db;
        const candidateCollection = db?.collection('candidateDetails');
        setImmediate(() => {
          candidateCollection?.findOne({ email: { $regex: `^${user.email}$`, $options: 'i' } })
            .then(candidateDoc => {
              if (!candidateDoc?._id) return null;
              return resumeProfileService.deriveAndStore({
                candidateId: candidateDoc._id.toString(),
                resumeUrl: result.resumeLink,
              });
            })
            .catch(err => logger.warn('resumeProfileService failed (non-blocking)', {
              uploaderEmail: user.email,
              resumeLink: result.resumeLink,
              err: err.message,
            }));
        });
      }

      return res.status(201).json({
        success: true,
        resumeLink: result.resumeLink,
        objectKey: result.objectKey
      });
    } catch (error) {
      logger.error('Resume upload handler failed', {
        error: error.message,
        userEmail: req.user?.email
      });

      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode === 400 ? error.message : 'Unable to upload resume'
      });
    }
  }

  async getPOMissingDate(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      const normalizedRole = (user.role || '').trim().toLowerCase();
      if (!['admin', 'mam', 'mm', 'mlead', 'recruiter'].includes(normalizedRole)) {
        return res.status(403).json({ success: false, error: 'Access denied' });
      }

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const docs = await col.find(
        { ...scope, status: 'Placement Offer', poDate: { $exists: false } },
        { projection: { _id: 1, 'Candidate Name': 1, Recruiter: 1, updated_at: 1 } }
      ).limit(100).toArray();

      return res.json({
        success: true,
        count: docs.length,
        candidates: docs.map(d => ({
          id: d._id.toString(),
          name: d['Candidate Name'] || '',
          recruiter: d.Recruiter || '',
          updatedAt: d.updated_at
        }))
      });
    } catch (error) {
      logger.error('getPOMissingDate failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getMissingResumes(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      // Marketing team only. Admin manages globally and gets flooded by
      // this prompt, so they're explicitly excluded.
      const role = (user.role || '').trim().toLowerCase();
      if (!['mm', 'mam', 'mlead'].includes(role)) {
        return res.json({ success: true, total: 0, candidates: [] });
      }

      // Reuse the SAME service the Branch Candidates socket handler
      // uses so the scope is exactly identical — whatever the user can
      // see in Branch Candidates, this set is a subset of.
      const result = await candidateService.getCandidatesForUser(user, {});
      const all = Array.isArray(result?.candidates) ? result.candidates : [];

      // Filter to Active + missing resume in JS — the service's return
      // shape varies between role paths; this avoids re-implementing
      // each scope's mongo filter.
      const missing = all.filter((c) => {
        const status = (c.status || c.Status || '').trim().toLowerCase();
        if (status !== 'active') return false;
        const link = c.resumeLink || c.resumeUrl || '';
        return !link;
      });

      return res.json({
        success: true,
        total: missing.length,
        candidates: missing.slice(0, 100).map((c) => ({
          id: c.id || c._id?.toString?.() || c._id || '',
          name: c['Candidate Name'] || c.name || c.candidateName || '',
          technology: c.Technology || c.technology || '',
          recruiter: c.recruiter || c.Recruiter || '',
          branch: c.Branch || c.branch || '',
        })),
      });
    } catch (error) {
      logger.error('getMissingResumes failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubStats(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const [statusAgg, branchAgg] = await Promise.all([
        col.aggregate([{ $match: scope }, { $group: { _id: '$status', count: { $sum: 1 } } }]).toArray(),
        col.aggregate([{ $match: scope }, { $group: { _id: '$Branch', count: { $sum: 1 } } }, { $sort: { count: -1 } }]).toArray(),
      ]);

      const byStatus = {};
      let total = 0;
      for (const s of statusAgg) {
        const key = (s._id || 'Unassigned').trim();
        byStatus[key] = (byStatus[key] || 0) + s.count;
        total += s.count;
      }

      const branchColors = { GGR: '#635bff', LKN: '#0cce6b', AHM: '#f5a623', UK: '#ab6bff' };
      const branches = branchAgg.map(b => ({
        name: b._id || 'Unassigned',
        count: b.count,
        color: branchColors[b._id] || '#6b7280',
      }));

      return res.json({
        success: true,
        kpi: {
          total,
          active: (byStatus['Active'] || 0),
          po: (byStatus['Placement Offer'] || 0),
          hold: (byStatus['Hold'] || 0),
          backout: (byStatus['Backout'] || 0),
          lowPriority: (byStatus['Low Priority'] || 0),
          unassigned: (byStatus['Unassigned'] || 0),
        },
        branches,
        statusBreakdown: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
      });
    } catch (error) {
      logger.error('getHubStats failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubProfiles(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const { branch, status, search, recruiterEmail, page = '1', limit = '50' } = req.query;
      const filter = { ...scope };
      if (branch && branch !== 'all') filter.Branch = branch === 'Unassigned' ? null : branch;
      if (status && status !== 'all') filter.status = status === 'Unassigned' ? null : status;
      if (recruiterEmail) {
        filter.$and = [...(filter.$and || []), { Recruiter: { $regex: new RegExp(`^${recruiterEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }];
      }
      if (search) {
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'i');
        const searchOr = [{ 'Candidate Name': re }, { Recruiter: re }, { Technology: re }];
        filter.$and = [...(filter.$and || []), { $or: searchOr }];
      }

      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [docs, total] = await Promise.all([
        col.find(filter, {
          projection: { _id: 1, 'Candidate Name': 1, Technology: 1, Branch: 1, Recruiter: 1, status: 1, updated_at: 1, poDate: 1 }
        }).sort({ updated_at: -1 }).skip(skip).limit(parseInt(limit)).toArray(),
        col.countDocuments(filter),
      ]);

      return res.json({
        success: true,
        total,
        page: parseInt(page),
        profiles: docs.map(d => ({
          id: d._id.toString(),
          name: d['Candidate Name'] || '',
          technology: d.Technology || '',
          branch: d.Branch || 'Unassigned',
          recruiter: d.Recruiter || '',
          status: d.status || 'Unassigned',
          updatedAt: d.updated_at,
          poDate: d.poDate ?? null,
        })),
      });
    } catch (error) {
      logger.error('getHubProfiles failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubRecruiters(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const agg = await col.aggregate([
        { $match: { ...scope, Recruiter: { $exists: true, $ne: null, $ne: '' } } },
        {
          $group: {
            _id: '$Recruiter',
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$status', 'Active'] }, 1, 0] } },
            po: { $sum: { $cond: [{ $eq: ['$status', 'Placement Offer'] }, 1, 0] } },
            hold: { $sum: { $cond: [{ $eq: ['$status', 'Hold'] }, 1, 0] } },
            backout: { $sum: { $cond: [{ $eq: ['$status', 'Backout'] }, 1, 0] } },
          }
        },
        { $sort: { total: -1 } },
        { $limit: 20 },
      ]).toArray();

      // Filter to marketing domains only
      const marketingRecruiters = agg.filter(r => {
        const domain = (r._id || '').split('@')[1] || '';
        return MARKETING_DOMAINS.includes(domain);
      });

      return res.json({
        success: true,
        recruiters: marketingRecruiters.map(r => {
          const namePart = (r._id || '').split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          return { email: r._id, name: namePart, total: r.total, active: r.active, po: r.po, hold: r.hold, backout: r.backout };
        }),
      });
    } catch (error) {
      logger.error('getHubRecruiters failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubAlerts(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const docs = await col.find(
        { ...scope, status: 'Hold' },
        { projection: { _id: 1, 'Candidate Name': 1, Branch: 1, Recruiter: 1, updated_at: 1, statusHistory: 1 } }
      ).sort({ updated_at: 1 }).limit(100).toArray();

      const now = Date.now();
      const alerts = docs.map(d => {
        // Find the Hold entry in statusHistory for accurate date
        const holdEntry = Array.isArray(d.statusHistory)
          ? d.statusHistory.slice().reverse().find(e => e.status === 'Hold')
          : null;
        const sinceDate = holdEntry?.changedAt || d.updated_at;
        const daysOnHold = sinceDate ? Math.floor((now - new Date(sinceDate).getTime()) / 86400000) : null;
        const severity = daysOnHold >= 30 ? 'critical' : daysOnHold >= 14 ? 'high' : 'medium';
        return {
          id: d._id.toString(),
          name: d['Candidate Name'] || '',
          branch: d.Branch || 'Unassigned',
          recruiter: d.Recruiter || '',
          sinceDate,
          daysOnHold,
          severity,
        };
      });

      return res.json({ success: true, alerts });
    } catch (error) {
      logger.error('getHubAlerts failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubPO(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const docs = await col.find(
        { ...scope, status: 'Placement Offer' },
        { projection: { _id: 1, 'Candidate Name': 1, Branch: 1, Recruiter: 1, Technology: 1, poDate: 1, updated_at: 1 } }
      ).sort({ poDate: -1 }).limit(200).toArray();

      const missingPoDate = docs.filter(d => !d.poDate).length;

      return res.json({
        success: true,
        total: docs.length,
        missingPoDate,
        candidates: docs.map(d => ({
          id: d._id.toString(),
          name: d['Candidate Name'] || '',
          branch: d.Branch || 'Unassigned',
          recruiter: d.Recruiter || '',
          technology: d.Technology || '',
          poDate: d.poDate ?? null,
          updatedAt: d.updated_at,
        })),
      });
    } catch (error) {
      logger.error('getHubPO failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getGrouped(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);

      const STATUS_ORDER = ['Active', 'Placement Offer', 'Hold', 'Low Priority', 'Backout', 'Unassigned'];

      // Get all candidates in scope with minimal projection
      const docs = await col.find(scope, {
        projection: {
          _id: 1,
          'Candidate Name': 1,
          Technology: 1,
          Branch: 1,
          Recruiter: 1,
          Expert: 1,
          status: 1,
          updated_at: 1,
        }
      }).sort({ updated_at: -1 }).toArray();

      // Group by status
      const groupMap = {};
      for (const doc of docs) {
        const key = (doc.status || 'Unassigned').trim();
        if (!groupMap[key]) groupMap[key] = [];
        groupMap[key].push({
          id: doc._id.toString(),
          name: doc['Candidate Name'] || '',
          technology: doc.Technology || '',
          branch: doc.Branch || 'Unassigned',
          recruiter: doc.Recruiter || '',
          expert: doc.Expert || '',
          updatedAt: doc.updated_at || null,
        });
      }

      const groups = STATUS_ORDER
        .filter(s => groupMap[s])
        .map(s => ({ status: s, count: groupMap[s].length, candidates: groupMap[s].slice(0, 20) }));

      // Append any statuses not in STATUS_ORDER
      for (const [status, candidates] of Object.entries(groupMap)) {
        if (!STATUS_ORDER.includes(status)) {
          groups.push({ status, count: candidates.length, candidates: candidates.slice(0, 20) });
        }
      }

      return res.json({ success: true, total: docs.length, groups });
    } catch (error) {
      logger.error('getGrouped failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getCandidateById(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { id } = req.params;
      let oid;
      try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, error: 'Invalid candidate ID' }); }

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const doc = await col.findOne({ _id: oid });
      if (!doc) return res.status(404).json({ success: false, error: 'Candidate not found' });

      // Fetch interview tasks from taskBody collection
      const taskCol = database.getCollection('taskBody');
      const tasks = taskCol ? await taskCol.find(
        { 'Email ID': doc['Email ID'] },
        { projection: {
          _id: 1,
          'Date of Interview': 1, 'Start Time Of Interview': 1, 'End Time Of Interview': 1,
          'Job Title': 1, 'End Client': 1, 'Interview Round': 1, 'Actual Round': 1,
          status: 1, Vendor: 1, sender: 1, assignedTo: 1, assignedExpert: 1, assignedAt: 1,
          suggestions: 1, receivedDateTime: 1
        } }
      ).sort({ 'Date of Interview': -1 }).limit(100).toArray() : [];

      return res.json({
        success: true,
        candidate: {
          id:         doc._id.toString(),
          name:       doc['Candidate Name'] || '',
          email:      doc['Email ID'] || '',
          contact:    doc.Contact || doc.contact || '',
          technology: doc.Technology || '',
          branch:     doc.Branch || 'Unassigned',
          recruiter:  doc.Recruiter || '',
          expert:     doc.Expert || '',
          status:     doc.status || 'Unassigned',
          poDate:     doc.poDate ?? null,
          receivedDate: doc.received_at || doc.createdAt || null,
          updatedAt:  doc.updated_at || null,
          resumeLink: doc.resumeLink || null,
          statusHistory: Array.isArray(doc.statusHistory) ? doc.statusHistory : [],
          workflowStatus: doc.workflowStatus || '',
        },
        interviews: tasks.map(t => ({
          taskId:     t._id.toString(),
          date:       t['Date of Interview'] || null,
          startTime:  t['Start Time Of Interview'] || null,
          endTime:    t['End Time Of Interview'] || null,
          role:       t['Job Title'] || '',
          client:     t['End Client'] || '',
          round:      t['Interview Round'] || '',
          actualRound: t['Actual Round'] || t.actualRound || '',
          vendor:     t.Vendor || '',
          status:     t.status || '',
          assignedTo: t.assignedTo || t.assignedExpert || '',
          assignedAt: t.assignedAt || null,
          recruiter:  t.sender || '',
          suggestions: Array.isArray(t.suggestions) ? t.suggestions : [],
          receivedAt: t.receivedDateTime || null,
        })),
      });
    } catch (error) {
      logger.error('getCandidateById failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubConfig(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      const defaults = {
        agingThresholds: { fresh: 2, warm: 5, aging: 10 },
        workloadConfig: { defaultCapacity: 20, capacities: {} },
      };

      const col = database.getCollection('hubConfig');
      if (!col) return res.json({ success: true, ...defaults });

      const docs = await col.find({ key: { $in: ['agingThresholds', 'workloadConfig'] } }).toArray();
      const byKey = {};
      for (const d of docs) byKey[d.key] = d.value;

      return res.json({
        success: true,
        agingThresholds: byKey.agingThresholds || defaults.agingThresholds,
        workloadConfig:  byKey.workloadConfig  || defaults.workloadConfig,
      });
    } catch (error) {
      logger.error('getHubConfig failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async updateHubConfig(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      if ((user.role || '').trim().toLowerCase() !== 'admin') {
        return res.status(403).json({ success: false, error: 'Admin only' });
      }

      const { key, value } = req.body;
      if (!key || !['agingThresholds', 'workloadConfig'].includes(key)) {
        return res.status(400).json({ success: false, error: 'Invalid key' });
      }
      if (!value || typeof value !== 'object') {
        return res.status(400).json({ success: false, error: 'value must be an object' });
      }

      const col = database.getCollection('hubConfig');
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      await col.updateOne(
        { key },
        { $set: { key, value, updatedBy: user.email, updatedAt: new Date() } },
        { upsert: true }
      );

      return res.json({ success: true, key, value });
    } catch (error) {
      logger.error('updateHubConfig failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubAging(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      // Load thresholds from hubConfig (fall back to defaults)
      const defaultThresholds = { fresh: 2, warm: 5, aging: 10 };
      let thresholds = defaultThresholds;
      const cfgCol = database.getCollection('hubConfig');
      if (cfgCol) {
        const cfgDoc = await cfgCol.findOne({ key: 'agingThresholds' });
        if (cfgDoc?.value) thresholds = cfgDoc.value;
      }

      const scope = await this._scopeFilter(user);
      const { branch } = req.query;
      const filter = {
        ...scope,
        status: { $nin: ['Backout', 'Placement Offer'] },
      };
      if (branch) filter.Branch = branch;

      const docs = await col.find(filter, {
        projection: { _id: 1, 'Candidate Name': 1, Recruiter: 1, Branch: 1, status: 1, updated_at: 1, created_at: 1 }
      }).toArray();

      const summary = { fresh: 0, warm: 0, aging: 0, critical: 0, total: 0 };
      const candidates = docs.map(doc => {
        const lastActivity = doc.updated_at || doc.created_at;
        const idleDays = lastActivity
          ? Math.floor((Date.now() - new Date(lastActivity).getTime()) / 86400000)
          : 9999;
        let agingStatus;
        if (idleDays <= thresholds.fresh) agingStatus = 'fresh';
        else if (idleDays <= thresholds.warm) agingStatus = 'warm';
        else if (idleDays <= thresholds.aging) agingStatus = 'aging';
        else agingStatus = 'critical';

        summary[agingStatus]++;
        summary.total++;

        return {
          _id: doc._id,
          name: doc['Candidate Name'] || '',
          recruiter: doc.Recruiter || '',
          branch: doc.Branch || 'Unassigned',
          status: doc.status || 'Unassigned',
          idleDays,
          agingStatus,
          lastActivity,
        };
      });

      candidates.sort((a, b) => b.idleDays - a.idleDays);

      return res.json({ success: true, thresholds, summary, candidates });
    } catch (error) {
      logger.error('getHubAging failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getTaskById(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });

      const { taskId } = req.params;
      const full = req.query.full === 'true';
      let oid;
      try { oid = new ObjectId(taskId); } catch { return res.status(400).json({ success: false, error: 'Invalid task ID' }); }

      const taskCol = database.getCollection('taskBody');
      if (!taskCol) return res.status(503).json({ success: false, error: 'Database not ready' });

      // full=true includes email body + replies thread
      const projection = full ? {} : { body: 0, replies: 0 };
      const doc = await taskCol.findOne({ _id: oid }, { projection });
      if (!doc) return res.status(404).json({ success: false, error: 'Task not found' });

      // Resolve candidateId from Email ID
      let candidateId = null;
      const emailId = doc['Email ID'];
      if (emailId) {
        const candCol = candidateModel.collection;
        if (candCol) {
          const cand = await candCol.findOne({ 'Email ID': emailId }, { projection: { _id: 1 } });
          if (cand) candidateId = cand._id.toString();
        }
      }

      // Format replies: [{body, receivedDateTime, from}]
      const replies = full && Array.isArray(doc.replies)
        ? doc.replies.map(r => ({
            body:      r.body || r.textBody || r.htmlBody || '',
            from:      r.from || r.sender || '',
            receivedAt: r.receivedDateTime || r.date || null,
          })).filter(r => r.body)
        : [];

      return res.json({
        success: true,
        task: {
          // Both naming conventions — TaskSheet reads task._id, older
          // surfaces read task.taskId. Keep both so we don't break either.
          _id:          doc._id.toString(),
          taskId:       doc._id.toString(),
          candidateId,
          candidateName: doc['Candidate Name'] || '',
          emailId:      doc['Email ID'] || '',
          date:         doc['Date of Interview'] || null,
          startTime:    doc['Start Time Of Interview'] || null,
          endTime:      doc['End Time Of Interview'] || null,
          role:         doc['Job Title'] || '',
          client:       doc['End Client'] || '',
          round:        doc['Interview Round'] || '',
          actualRound:  doc['Actual Round'] || doc.actualRound || '',
          status:       doc.status || '',
          vendor:       doc.Vendor || '',
          recruiter:    doc.sender || '',
          assignedTo:   doc.assignedTo || doc.assignedExpert || '',
          assignedAt:   doc.assignedAt || null,
          suggestions:  Array.isArray(doc.suggestions) ? doc.suggestions : [],
          receivedAt:   doc.receivedDateTime || null,
          // Meeting link + bot fields used by TaskSheet's Meeting Link panel.
          // Without these the panel always rendered "No meeting link set yet".
          meetingLink:        doc.meetingLink || null,
          joinUrl:            doc.joinUrl || null,
          joinWebUrl:         doc.joinWebUrl || null,
          meetingPassword:    doc.meetingPassword || null,
          botStatus:          doc.botStatus || null,
          botInviteAttempts:  typeof doc.botInviteAttempts === 'number' ? doc.botInviteAttempts : null,
          botJoinedAt:        doc.botJoinedAt || null,
          botLastError:       doc.botLastError || null,
          // Full mode extras
          body:    full ? (doc.body || doc.textBody || '') : undefined,
          replies: full ? replies : undefined,
          subject: doc.subject || doc.Subject || '',
        },
      });
    } catch (error) {
      logger.error('getTaskById failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getHubWorkload(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const col = candidateModel.collection;
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      // Load workloadConfig from hubConfig collection
      const cfgCol = database.getCollection('hubConfig');
      let workloadConfig = { defaultCapacity: 20, capacities: {} };
      if (cfgCol) {
        const doc = await cfgCol.findOne({ key: 'workloadConfig' });
        if (doc?.value) workloadConfig = doc.value;
      }
      const { defaultCapacity, capacities = {} } = workloadConfig;

      // Apply scope filter (same as other hub methods)
      const scope = await this._scopeFilter(user);

      // Aggregate active count per recruiter
      const activeAgg = await col.aggregate([
        { $match: { ...scope, Recruiter: { $exists: true, $ne: null }, status: 'Active' } },
        { $group: { _id: '$Recruiter', activeCount: { $sum: 1 } } },
      ]).toArray();

      // Aggregate total count per recruiter (all statuses)
      const totalAgg = await col.aggregate([
        { $match: { ...scope, Recruiter: { $exists: true, $ne: null } } },
        { $group: { _id: '$Recruiter', totalCount: { $sum: 1 } } },
      ]).toArray();

      // Build lookup maps
      const activeMap = {};
      for (const r of activeAgg) {
        if (r._id) activeMap[r._id.toLowerCase()] = { email: r._id, activeCount: r.activeCount };
      }
      const totalMap = {};
      for (const r of totalAgg) {
        if (r._id) totalMap[r._id.toLowerCase()] = r.totalCount;
      }

      // Merge and filter to vizvainc.com domain only
      const allEmails = new Set([...Object.keys(activeMap), ...Object.keys(totalMap)]);
      const recruiters = [];
      for (const emailLower of allEmails) {
        const domain = emailLower.split('@')[1] || '';
        if (domain !== 'vizvainc.com') continue;

        const email = activeMap[emailLower]?.email || emailLower;
        const activeCount = activeMap[emailLower]?.activeCount || 0;
        const totalCount = totalMap[emailLower] || 0;
        const capacity = capacities[email] || capacities[emailLower] || defaultCapacity;
        const workloadRatio = Math.round((activeCount / capacity) * 100) / 100;
        let workloadStatus;
        if (workloadRatio > 0.9)       workloadStatus = 'overloaded';
        else if (workloadRatio >= 0.4) workloadStatus = 'optimal';
        else                           workloadStatus = 'underutilized';

        const name = email.split('@')[0].replace(/[._]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        recruiters.push({ email, name, activeCount, totalCount, capacity, workloadRatio, workloadStatus });
      }

      // Sort by workloadRatio descending (most loaded first)
      recruiters.sort((a, b) => b.workloadRatio - a.workloadRatio);

      return res.json({
        success: true,
        config: { defaultCapacity, capacities },
        recruiters,
      });
    } catch (error) {
      logger.error('getHubWorkload failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async getDistinctClients(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const col = database.getCollection('candidateDetails');
      if (!col) return res.status(503).json({ success: false, error: 'Database not ready' });

      const scope = await this._scopeFilter(user);
      const filter = {
        'End Client': { $exists: true, $nin: [null, '', undefined] },
        ...scope,
      };

      let fromCandidates = await col.distinct('End Client', filter);

      // Defensively strip empty/whitespace-only entries that slipped through
      fromCandidates = fromCandidates.filter(c => typeof c === 'string' && c.trim().length > 0);

      // Pull curated names from endClients collection
      const endClientsCol = database.getCollection('endClients');
      let fromCurated = [];
      if (endClientsCol) {
        const docs = await endClientsCol.find({}, { projection: { name: 1, normalizedName: 1 } }).toArray();
        fromCurated = docs.map(d => d.name).filter(n => typeof n === 'string' && n.trim().length > 0);
      }

      // Union: prefer curated canonical name when normalizedNames overlap
      const curatedNormSet = new Set();
      const curatedByNorm = {};
      for (const name of fromCurated) {
        const norm = name.toLowerCase();
        curatedNormSet.add(norm);
        curatedByNorm[norm] = name;
      }

      const seen = new Set();
      const clients = [];

      // Add curated names first (they are canonical)
      for (const name of fromCurated) {
        const norm = name.toLowerCase();
        if (!seen.has(norm)) {
          seen.add(norm);
          clients.push(name);
        }
      }

      // Add candidateDetails values only when not already covered by curated
      for (const name of fromCandidates) {
        const norm = name.toLowerCase();
        if (!seen.has(norm)) {
          seen.add(norm);
          clients.push(name);
        }
      }

      // Sort case-insensitively
      clients.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

      res.set('Cache-Control', 'private, max-age=60');
      return res.json({ success: true, clients });
    } catch (error) {
      logger.error('getDistinctClients failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }

  async addEndClient(req, res) {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const role = (user.role || '').trim().toLowerCase();
      if (!MARKETING_ROLES.includes(role)) return res.status(403).json({ success: false, error: 'Access denied' });

      const rawName = (req.body?.name ?? '');

      // Trim + collapse whitespace
      const trimmed = rawName.trim().replace(/\s+/g, ' ');

      if (!trimmed) {
        return res.status(400).json({ success: false, error: 'name is required' });
      }
      if (trimmed.length > 200) {
        return res.status(400).json({ success: false, error: 'name must be 200 characters or fewer' });
      }

      // Title-case: capitalize first letter of each word; preserve all-caps tokens ≤ 4 chars (e.g. "IBM")
      const canonicalName = trimmed.split(' ').map((word, _i, _arr) => {
        // Preserve short all-caps tokens like IBM, IT, US, etc.
        if (word.length <= 4 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
          return word;
        }
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }).join(' ');

      const normalizedName = canonicalName.toLowerCase();

      // Check uniqueness in endClients collection
      const endClientsCol = database.getCollection('endClients');
      if (endClientsCol) {
        const existing = await endClientsCol.findOne({ normalizedName });
        if (existing) {
          return res.status(409).json({
            success: false,
            error: 'Company already exists',
            existing: existing.name,
          });
        }
      }

      // Check uniqueness in candidateDetails distinct values (case-insensitive)
      const candidateDetailsCol = database.getCollection('candidateDetails');
      if (candidateDetailsCol) {
        const candidateClients = await candidateDetailsCol.distinct('End Client', {
          'End Client': { $exists: true, $nin: [null, ''] },
        });
        const matchInCandidates = candidateClients.find(
          c => typeof c === 'string' && c.trim().toLowerCase() === normalizedName
        );
        if (matchInCandidates) {
          return res.status(409).json({
            success: false,
            error: 'Company already exists',
            existing: matchInCandidates,
          });
        }
      }

      // Insert into endClients collection
      if (!endClientsCol) {
        return res.status(503).json({ success: false, error: 'Database not ready' });
      }

      await endClientsCol.insertOne({
        name: canonicalName,
        normalizedName,
        createdBy: user.email,
        createdAt: new Date(),
      });

      return res.status(201).json({ success: true, client: canonicalName });
    } catch (error) {
      logger.error('addEndClient failed', { error: error.message });
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
  // ── Read cached forge search profile ──────────────────────────────────────

  async getForgeProfile(req, res) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: 'Invalid candidate ID' });
      }
      const forgeProfile = await resumeProfileService.getCached(id);
      return res.status(200).json({ success: true, forgeProfile: forgeProfile || null });
    } catch (error) {
      logger.error('getForgeProfile failed', { error: error.message, candidateId: req.params?.id });
      return res.status(500).json({ success: false, error: error.message });
    }
  }

  // ── Admin: manually re-derive search profile ──────────────────────────────

  async deriveProfile(req, res) {
    try {
      const user = req.user;
      if (!user) {
        return res.status(401).json({ success: false, error: 'Authentication required' });
      }
      const normalizedRole = (user.role || '').trim().toLowerCase();
      if (!['admin', 'mm', 'mam', 'mlead', 'manager', 'recruiter'].includes(normalizedRole)) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions' });
      }

      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: 'Invalid candidate ID' });
      }

      const db = database.getDb();
      const candidateDoc = await db.collection('candidateDetails').findOne({ _id: new ObjectId(id) });
      if (!candidateDoc) {
        return res.status(404).json({ success: false, error: 'Candidate not found' });
      }
      if (!candidateDoc.resumeLink) {
        return res.status(422).json({ success: false, error: 'Candidate has no resumeLink' });
      }

      logger.info('deriveProfile: starting', {
        candidateId: id,
        triggeredBy: user.email,
        resumeLink: candidateDoc.resumeLink,
        model: process.env.RESUME_PROFILE_MODEL || 'gpt-4o-mini',
      });
      const forgeProfile = await resumeProfileService.deriveAndStore({
        candidateId: id,
        resumeUrl: candidateDoc.resumeLink,
        force: true,
      });
      logger.info('deriveProfile: complete', {
        candidateId: id,
        titles: forgeProfile?.titles?.length || 0,
        keywords: forgeProfile?.keywords?.length || 0,
        years: `${forgeProfile?.years_min}-${forgeProfile?.years_max}`,
      });

      return res.status(200).json({ success: true, forgeProfile });
    } catch (error) {
      logger.error('deriveProfile failed', {
        error: error.message,
        stack: error.stack?.split('\n').slice(0, 5).join('\n'),
        candidateId: req.params?.id,
      });
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}

export const candidateController = new CandidateController();
