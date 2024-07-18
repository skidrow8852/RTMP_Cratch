const spawn = require('child_process').spawn;

const generateStreamThumbnail = (stream_key) => {
    const args = [
        '-y',
        '-i', 'http://localhost:8000/live/'+stream_key+'/index.m3u8',
        '-ss', '00:00:01',
        '-vframes', '1',
        '-vf', 'scale=-2:300',
        '/home/sites/rtmp/media/live/'+stream_key+'/image.png',
    ];

    const thumbnailProcess = spawn('/usr/bin/ffmpeg', args);

    thumbnailProcess.on('error', (err) => {
        console.error('Error generating thumbnail:', err);
    });

    thumbnailProcess.on('exit', (code) => {
        console.log('Thumbnail generation process exited with code:', code);
    });
};


module.exports = {
    generateStreamThumbnail : generateStreamThumbnail
};
