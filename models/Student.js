const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  firstName:     { type: String, required: true, trim: true },
  middleName:    { type: String, default: '', trim: true },
  lastName:      { type: String, required: true, trim: true },
  sex:           { type: String, default: '' },
  birthday:      { type: String, default: '' },
  lrn:           { type: String, required: true, trim: true },
  section:       { type: String, required: true, trim: true },
  address:       { type: String, default: '' },
  parentName:    { type: String, default: '' },
  contactNumber: { type: String, default: '' },
  entryMethod:   { type: String, default: 'Individual' },
  photoPath:     { type: String, default: '' },
  photoMime:     { type: String, default: '' },
  photoSource:   { type: String, default: '' },
  uploadStatus:  { type: String, default: 'pending' },
  uploadError:   { type: String, default: null },
  driveUploaded: { type: Boolean, default: false },
  driveLink:     { type: String, default: null },
  driveFiles:    { type: mongoose.Schema.Types.Mixed, default: null },
  idCardDocxPath:{ type: String, default: null }
}, {
  timestamps: true
});

studentSchema.index({ lrn: 1 });
studentSchema.index({ section: 1 });
studentSchema.index({ uploadStatus: 1 });

module.exports = mongoose.model('Student', studentSchema);
