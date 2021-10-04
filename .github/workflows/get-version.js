var fs = require('fs');
console.log(JSON.parse(fs.readFileSync('./betterrollssw5e/module.json', 'utf8')).version);