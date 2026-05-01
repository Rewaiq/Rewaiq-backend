const express = require('express');
const router = express.Router();
const {
  getProfile,
  updateProfile,
  uploadProfilePicture,
  updateInterests
} = require('../controllers/profileController');
const { protect } = require('../middleware/auth');
const { upload } = require('../config/cloudinary');

router.get('/', protect, getProfile);
router.put('/update', protect, updateProfile);
router.post('/picture', protect, upload.single('profile_picture'), uploadProfilePicture);
router.put('/interests', protect, updateInterests);

module.exports = router;