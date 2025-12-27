const bcrypt = require('bcryptjs');

const plain = process.argv[2];

if (!plain) {
  console.log('用法：node hash-password.js Qq112233.');
  process.exit(1);
}

const hash = bcrypt.hashSync(plain, 10);
console.log('你的密碼雜湊是：');
console.log(hash);
