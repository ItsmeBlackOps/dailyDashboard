import { ObjectId } from 'mongodb';
import { database } from '../config/database.js';
import { graphMailService } from '../services/graphMailService.js';
import { logger } from '../utils/logger.js';

function bearerFrom(req) {
  const header = req.headers?.authorization || '';
  const match = /^Bearer\s+(.+)/i.exec(header);
  return match ? match[1] : '';
}

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
    `Rate: ${po.rate || ''}`,
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
        agreementPct:    body.agreementPct     != null ? Number(body.agreementPct)    : null,
        agreementMonths: body.agreementMonths  != null ? Number(body.agreementMonths) : null,
        upfrontAmount:   body.upfrontAmount    != null ? Number(body.upfrontAmount)   : null,
        poCount: {
          total: Number(body.poCount?.total ?? 0),
          ggr:   Number(body.poCount?.ggr   ?? 0),
          lkn:   Number(body.poCount?.lkn   ?? 0),
          ahm:   Number(body.poCount?.ahm   ?? 0),
          lko:   Number(body.poCount?.lko   ?? 0),
          uk:    Number(body.poCount?.uk    ?? 0),
        },
        interviewExpert: body.interviewExpert  || null,
        isDraft:         body.isDraft !== false,
        sourceTaskId:    body.sourceTaskId     ? new ObjectId(body.sourceTaskId)    : null,
        candidateId:     body.candidateId      ? new ObjectId(body.candidateId)     : null,
        updatedAt:       now,
      };

      let result;
      if (body._id) {
        const { _id, ...update } = doc;
        result = await col.findOneAndUpdate(
          { _id: new ObjectId(body._id) },
          { $set: update },
          { returnDocument: 'after' }
        );
        return res.json({ success: true, po: result });
      } else {
        doc.createdBy = user.email;
        doc.createdAt = now;
        const inserted = await col.insertOne(doc);
        return res.json({ success: true, po: { ...doc, _id: inserted.insertedId } });
      }
    } catch (err) {
      logger.error('POController.createOrUpdate error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
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

      const page  = Math.max(1, parseInt(req.query.page  ?? '1',  10));
      const limit = Math.min(200, parseInt(req.query.limit ?? '50', 10));
      const skip  = (page - 1) * limit;

      const [items, total] = await Promise.all([
        col.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);

      return res.json({ success: true, data: items, total, page, limit });
    } catch (err) {
      logger.error('POController.list error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // GET /api/po/candidate/:candidateId — get PO for a candidate
  async getByCandidateId(req, res) {
    try {
      const col = await this.getCollection();
      const po = await col.findOne({ candidateId: new ObjectId(req.params.candidateId) });
      return res.json({ success: true, po: po ?? null });
    } catch (err) {
      logger.error('POController.getByCandidateId error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // DELETE /api/po/:id
  async remove(req, res) {
    try {
      const col = await this.getCollection();
      await col.deleteOne({ _id: new ObjectId(req.params.id) });
      return res.json({ success: true });
    } catch (err) {
      logger.error('POController.remove error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }

  // POST /api/po/:id/draft-email — create Outlook draft via Graph OBO
  async createDraftEmail(req, res) {
    try {
      const col = await this.getCollection();
      const po = await col.findOne({ _id: new ObjectId(req.params.id) });
      if (!po) return res.status(404).json({ success: false, error: 'PO not found' });

      const body = buildEmailBody(po);
      const draftPayload = {
        subject: `PO Details — ${po.candidateName}`,
        body: { contentType: 'Text', content: body },
      };

      const userAssertion = bearerFrom(req);
      const message = await graphMailService.createDraft(userAssertion, draftPayload);

      return res.json({
        success: true,
        messageId: message.id,
        webLink: message.webLink ?? null,
      });
    } catch (err) {
      logger.error('POController.createDraftEmail error', { error: err.message });
      return res.status(500).json({ success: false, error: err.message });
    }
  }
}

export const poController = new POController();
