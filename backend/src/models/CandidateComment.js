import mongoose from 'mongoose';

const candidateCommentSchema = new mongoose.Schema({
    candidateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Candidate',
        required: true,
        index: true
    },
    author: {
        email: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        role: {
            type: String,
            required: true
        }
    },
    content: {
        type: String,
        required: true,
        trim: true
    },
    type: {
        type: String,
        enum: ['internal', 'complaint'],
        default: 'internal'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true // adds createdAt, updatedAt
});

// Index for efficient retrieval by candidate
candidateCommentSchema.index({ candidateId: 1, createdAt: 1 });

const CandidateComment = mongoose.model('CandidateComment', candidateCommentSchema);

export default CandidateComment;
