const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('barclay_lc.db');

db.run(`
  UPDATE lc_applications
  SET applicant_name = 'Acme Corp Test',
      lc_expiry_date = '2025-12-31',
      goods_desc = '100x Solar Panels 400W'
  WHERE applicant_name IS NULL OR applicant_name = '' 
     OR lc_expiry_date IS NULL OR lc_expiry_date = '' 
     OR goods_desc IS NULL OR goods_desc = ''
`, function (err) {
    if (err) console.error(err);
    else console.log('Fixed ' + this.changes + ' rows');
    db.close();
});
