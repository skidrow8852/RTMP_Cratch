const Queue = require('bull');
const videoQueue = new Queue('video processing', 'redis://127.0.0.1:6379');


module.exports = videoQueue;
