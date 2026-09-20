const Student = require('./models/Student');
const Override = require('./models/Override');

function normalizeStr(str) {
  return (str || '').trim().toUpperCase();
}

async function all() {
  return Student.find().lean();
}

async function find(id) {
  return Student.findById(id).lean();
}

async function add(student) {
  const doc = await Student.create(student);
  return doc.toObject();
}

async function update(id, patch) {
  return Student.findByIdAndUpdate(id, patch, { new: true }).lean();
}

async function remove(id) {
  return Student.findByIdAndDelete(id);
}

async function findByLRN(lrn) {
  const normalized = (lrn || '').trim();
  if (!normalized) return null;
  return Student.findOne({ lrn: normalized }).lean();
}

async function findByName(firstName, lastName) {
  const fn = normalizeStr(firstName);
  const ln = normalizeStr(lastName);
  if (!fn || !ln) return null;
  return Student.findOne({
    firstName: { $regex: `^${fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    lastName:  { $regex: `^${ln.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
  }).lean();
}

async function checkDuplicate(firstName, lastName, lrn, excludeId) {
  const lrnMatch = await findByLRN(lrn);
  const nameMatch = await findByName(firstName, lastName);

  const matches = [];
  let matchedByLRN = false;
  let matchedByName = false;

  if (lrnMatch && String(lrnMatch._id) !== excludeId) {
    matchedByLRN = true;
    matches.push(lrnMatch);
  }

  if (nameMatch && String(nameMatch._id) !== excludeId) {
    matchedByName = true;
    if (!matches.find(m => String(m._id) === String(nameMatch._id))) {
      matches.push(nameMatch);
    }
  }

  return {
    isDuplicate: matches.length > 0,
    matchedByName,
    matchedByLRN,
    matches: matches.map(m => ({ ...m, id: String(m._id) }))
  };
}

async function logOverride(student) {
  return Override.create(student);
}

async function allOverrides() {
  return Override.find().lean();
}

async function reset() {
  await Student.deleteMany({});
}

async function resetOverrides() {
  await Override.deleteMany({});
}

module.exports = { all, find, add, update, remove, findByLRN, findByName, checkDuplicate, logOverride, allOverrides, reset, resetOverrides };
