const Database = require('better-sqlite3');
try {
  const db = new Database('../data/homeiptv.db');
  console.log("Success");
} catch (err) {
  console.error(err);
}
