const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
  getMyProgress,
  submitVoteProof,
  requireAdmin,
  getPendingVotes,
  reviewVote,
  getCampaignOverview
} = require('../controllers/foundersLiveController');

// Supporter endpoints — independent of /api/referrals.
router.get('/me', protect, getMyProgress);
router.post('/votes', protect, submitVoteProof);

// Admin review endpoints. Role is looked up in the database for every request.
router.get('/admin/overview', protect, requireAdmin, getCampaignOverview);
router.get('/admin/submissions/pending', protect, requireAdmin, getPendingVotes);
router.patch('/admin/submissions/:id/review', protect, requireAdmin, reviewVote);

module.exports = router;
