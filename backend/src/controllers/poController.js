import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { graphMailService } from '../services/graphMailService.js';
import { logger } from '../utils/logger.js';

function bearerFrom(req) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)/i.exec(header);
  return match ? match[1] : '';
}

function toObjectId(value, fieldName) {
  if (!value || !ObjectId.isValid(value)) {
    const err = new Error(`Invalid ObjectId for field '${fieldName}': ${value}`);
    err.statusCode = 400;
    throw err;
  }
  return new ObjectId(value);
}

const safeNum = (v, fallback = 0) => {
  const n = Number(v ?? fallback);
  return Number.isFinite(n) ? n : fallback;
};

function buildEmailBody(po) {
  const poCount = po.poCount || {};
  const parts = [
    `Total – ${poCount.total ?? 0}`,
    poCount.ggr  ? `GGR – ${poCount.ggr}`  : null,
    poCount.lkn  ? `LKN – ${poCount.lkn}`  : null,
    poCount.ahm  ? `AHM – ${poCount.ahm}`  : null,
    poCount.lko  ? `LKO – ${poCount.lko}`  : null,
    poCount.uk   ? `UK – ${poCount.uk}`     : null,
  ].filter(Boolean).join(' | ');

  return [
    'Hello Team,',
    `Kindly find the PO details of ${po.candidateName}`,
    '',
    `Name of Candidate: ${po.candidateName}`,
    `Branch: ${po.branch || ''} | Company: SST/Vizva`,
    `PO Count: ${parts}`,
    `Email ID: ${po.emailId || ''}`,
    `Type of Job: ${po.jobType || ''}`,
    `Position: ${po.position || ''}`,
    `Implementation/End Client: ${po.endClient || ''}`,
    `Vendor: ${po.vendor || ''}`,
    `Rate: ${po.rate ?? ''}`,
    `Signup Date: ${po.signupDate ? new Date(po.signupDate).toLocaleDateString('en-GB') : ''}`,
    `Joining Date: ${po.joiningDate ? new Date(po.joiningDate).toLocaleDateString('en-GB') : ''}`,
    `Agreement: ${po.agreementPct ?? ''}% in ${po.agreementMonths ?? ''} Months / Upfront – $${po.upfrontAmount ?? ''} (NR)`,
    '',
    `Marketing Recruiter: ${po.recruiter || ''}`,
    `Interview Support Expert: ${po.interviewExpert || ''}`,
  ].join('\n');
}

class POController {
  async getCollection() {
    const db = database.getDb();
    return db.collection('poDetails');
  }

  // POST /api/po — create or upsert
  async createOrUpdate(req, res) {
    try {
      const col = await this.getCollection();
      const user = req.user;
      const body = req.body;

      if (!body.candidateName) {
        return res.status(400).json({ success: false, error: 'candidateName is required' });
      }

      const now = new Date();
      const doc = {
        candidateName:   body.candidateName,
        emailId:         body.emailId         || null,
        endClient:       body.endClient        || null,
        position:        body.position         || null,
        vendor:          body.vendor           || null,
        branch:          body.branch           || null,
        recruiter:       body.recruiter        || null,
        jobType:         body.jobType          || null,
        rate:            body.rate             || null,
        signupDate:      body.signupDate       ? new Date(body.signupDate)  : null,
        joiningDate:     body.joiningDate      ? new Date(body.joiningDate) : null,
        agreementPct:    body.agreementPct     != null ? safeNum(body.agreementPct, null)    : null,
        agreementMonths: body.agreementMonths  != null ? safeNum(body.agreementMonths, null) : null,
        upfrontAmount:   body.upfrontAmount    != null ? safeNum(body.upfrontAmount, null)   : null,
        poCount: {
          total: safeNum(body.poCount?.total),
          ggr:   safeNum(body.poCount?.ggr),
          lkn:   safeNum(body.poCount?.lkn),
          ahm:   safeNum(body.poCount?.ahm),
          lko:   safeNum(body.poCount?.lko),
          uk:    safeNum(body.poCount?.uk),
        },
        interviewExpert: body.interviewExpert  || null,
        isDraft:         body.isDraft !== false,
        sourceTaskId:    body.sourceTaskId     ? toObjectId(body.sourceTaskId, 'sourceTaskId') : null,
        candidateId:     body.candidateId      ? toObjectId(body.candidateId, 'candidateId')   : null,
        updatedAt:       now,
      };

      let result;
      if (body._id) {
        const { _id, ...update } = doc;
        result = await col.findOneAndUpdate(
          { _id: toObjectId(body._id, '_id') },
          { $set: update },
          { returnDocument: 'after' }
        );
        if (!result) {
          return res.status(404).json({ success: false, error: 'PO not found' });
        }
        return res.json({ success: true, po: result });
      } else {
        doc.createdBy = user.email;
        doc.createdAt = now;
        const inserted = await col.insertOne(doc);
        return res.json({ success: true, po: { ...doc, _id: inserted.insertedId } });
      }
    } catch (err) {
      const status = err.statusCode || 500;
      logger.error('POController.createOrUpdate error', { error: err.message });
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  // GET /api/po — list with optional filters
  async list(req, res) {
    try {
      const col = await this.getCollection();
      const filter = {};
      if (req.query.branch)    filter.branch    = req.query.branch;
      if (req.query.recruiter) filter.recruiter = req.query.recruiter;
      if (req.query.isDraft !== undefined)
        filter.isDraft = req.query.isDraft === 'true';

      const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
      const skip  = (page - 1) * limit;

      const [items, total] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);

      return res.json({ success: true, data: items, total, page, limit });
    } catch (err) {
      const status = err.statusCode || 500;
      logger.error('POController.list error', { error: err.message });
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  // GET /api/po/candidate/:candidateId — get PO for a candidate
  async getByCandidateId(req, res) {
    try {
      const col = await this.getCollection();
      const po = await col.findOne({ candidateId: toObjectId(req.params.candidateId, 'candidateId') });
      return res.json({ success: true, po: po ?? null });
    } catch (err) {
      const status = err.statusCode || 500;
      logger.error('POController.getByCandidateId error', { error: err.message });
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  // DELETE /api/po/:id
  async remove(req, res) {
    try {
      const col = await this.getCollection();
      // Only admin, MAM, MM, mlead can delete PO records
      const allowedRoles = ['admin', 'mam', 'mm', 'mlead'];
      if (!allowedRoles.includes((req.user.role || '').toLowerCase())) {
        return res.status(403).json({ success: false, error: 'Insufficient permissions' });
      }
      await col.deleteOne({ _id: toObjectId(req.params.id, 'id') });
      return res.json({ success: true });
    } catch (err) {
      const status = err.statusCode || 500;
      logger.error('POController.remove error', { error: err.message });
      return res.status(status).json({ success: false, error: err.message });
    }
  }

  // POST /api/po/:id/draft-email — create Outlook draft via Graph OBO
  async createDraftEmail(req, res) {
    try {
      const col = await this.getCollection();
      const po = await col.findOne({ _id: toObjectId(req.params.id, 'id') });
      if (!po) return res.status(404).json({ success: false, error: 'PO not found' });

      const body = buildEmailBody(po);
      const draftPayload = {
        subject: `PO Details — ${po.candidateName}`,
        body: { contentType: 'Text', content: body },
      };

      const userAssertion = bearerFrom(req);
      if (!userAssertion) {
        return res.status(401).json({ success: false, error: 'Bearer token required for Outlook draft creation' });
      }
      const message = await graphMailService.createDraft(userAssertion, draftPayload);

      return res.json({
        success: true,
        messageId: message.id,
        webLink: message.webLink ?? null,
      });
    } catch (err) {
      const status = err.statusCode || 500;
      logger.error('POController.createDraftEmail error', { error: err.message });
      return res.status(status).json({ success: false, error: err.message });
    }
  }
}

export const poController = new POController();
