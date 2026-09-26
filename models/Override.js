const mongoose = require('mongoose');

const overrideSchema = new mongoose.Schema({
  firstName:     { type: String, default: '' },
  middleName:    { type: String, default: '' },
  lastName:      { type: String, default: '' },
  sex:           { type: String, default: '' },
  birthday:      { type: String, default: '' },
  lrn:           { type: String, default: '' },
  section:       { type: String, default: '' },
  address:       { type: String, default: '' },
  parentName:    { type: String, default: '' },
  contactNumber: { type: String, default: '' },
  entryMethod:   { type: String, default: '' },
  photoPath:     { type: String, default: '' },
  photoOriginalPath: { type: String, default: '' },
  uploadStatus:  { type: String, default: '' },
  driveUploaded: { type: Boolean, default: false },
  overriddenAt:  { type: Date, default: Date.now }
}, {
  timestamps: true
});

module.exports = mongoose.model('Override', overrideSchema);
