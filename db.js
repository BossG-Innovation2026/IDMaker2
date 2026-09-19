const mongoose = require('mongoose');

async function connectDB() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) {
    console.error('✗ MONGO_URI environment variable is not set');
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI);
    console.log('✓ Connected to MongoDB Atlas');
  } catch (err) {
    console.error('✗ MongoDB connection failed:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('error', err => {
    console.error('MongoDB connection error:', err.message);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('MongoDB disconnected — attempting reconnect...');
  });
}

module.exports = { connectDB };
