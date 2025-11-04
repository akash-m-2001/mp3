var mongoose = require('mongoose');
var UserSchema = new mongoose.Schema({
  name:  { type: String, required: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  pendingTasks: { type: [String], default: [] }, // array of Task _id strings
  dateCreated:  { type: Date, default: Date.now }
});
module.exports = mongoose.model('User', UserSchema);
