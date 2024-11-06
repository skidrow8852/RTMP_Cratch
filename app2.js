require('./connection');
const NodeMediaServer = require('node-media-server');
const Live = require("./modal/Live");
const StreamChat = require("./modal/StreamChat");
const SavedLive = require("./modal/SavedLive");
const SavedStreamChat = require("./modal/SavedStreamChat");
var { nanoid } = require('nanoid');
const Like = require('./modal/Likes');
const cron = require('node-cron');
const ffmpeg = require('fluent-ffmpeg');
const helpers = require("./helpers/helper");
const request = require("request");
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const { promisify } = require('util');
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const videoQueue = require('./redis');

// Configuration for NodeMediaServer
const config = {
  rtmp: {
    port: 1937,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8002,
    allow_origin: '*',
    mediaroot: './media'
  },
  auth: {
    api: true,
    api_user: process.env.ADMIN_USER,
    api_pass: process.env.ADMIN_PASS,
    play: false,
    publish: false
  },
  trans: {
    ffmpeg: '/usr/bin/ffmpeg',
    tasks: [
      {
        app: 'live',
        hls: true,
        hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
        mp4: true,
        mp4Flags: '[movflags=frag_keyframe+empty_moov]'
      }
    ]
  },
  relay: {
    ffmpeg: '/usr/bin/ffmpeg',
    tasks: [
      {
        app: 'live',
        mode: 'push',
        edge: 'rtmp://localhost:1935'
      },
      {
        app: 'live',
        mode: 'push',
        edge: 'rtmp://localhost:1936'
      }
    ]
  }
};

const nms = new NodeMediaServer(config);

// Helper function to extract stream key from stream path
const getStreamKeyFromStreamPath = (path) => {
  let parts = path.split('/');
  return parts[parts.length - 1];
};

// Pre-publish event handler
nms.on('prePublish', async (id, StreamPath, args) => {
  const stream_key = getStreamKeyFromStreamPath(StreamPath);
  console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);

  const activeStreams = await Live.countDocuments({ isActive: true });

  try {
    const user = await Live.findOne({ streamKey: stream_key });
    if (!user) {
      let session = nms.getSession(id);
      session.reject();
    } else {
      await helpers.generateStreamThumbnail(stream_key);
      await Live.findOneAndUpdate({ streamKey: stream_key }, {
        isActive: true,
        thumbnail: `https://live.cratch.io/live/${stream_key}/image.png`,
        views: 0,
        likes: 0,
        currentlyWatching: 0,
        numOfmessages: 0
      });
      await StreamChat.deleteMany({ liveId: user._id });
      await Like.deleteMany({ liveId: user._id });
    }
  } catch (err) {
    console.log(err);
  }
});

// Post-publish event handler
nms.on('donePublish', async (id, StreamPath, args) => {
  const stream_key = getStreamKeyFromStreamPath(StreamPath);
  const ID = nanoid();
  const currentPath = `/home/sites/cratch/live/rtmp/media/live/${stream_key}/video.mp4`;
  const newPath = `/home/sites/cratch/live/rtmp/media/live/${stream_key}/${ID}.mp4`;

  try {
    await exec(`mv ${currentPath} ${newPath}`);
    
    const liveUpdatePromise = Live.findOneAndUpdate({ streamKey: stream_key }, { isActive: false });
    const streamChatsPromise = StreamChat.find({ liveId: stream_key });
    const likesPromise = Like.find({ liveId: stream_key });

    const [live, streamChats, likes] = await Promise.all([liveUpdatePromise, streamChatsPromise, likesPromise]);

    const content = streamChats.map(chat => ({
      creator: chat.creator,
      liveId: chat.liveId,
      content: chat.content,
      createdAt: chat.createdAt
    }));

    await new SavedStreamChat({ streamId: ID, content }).save();

    const savedLive = await new SavedLive({
      creator: live.creator,
      streamId: ID,
      title: live.title,
      description: live.description,
      category: live.category,
      thumbnail: live.thumbnail,
      tags: live.tags,
      visibility: live.visibility,
      streamUrl: `https://live.cratch.io/live/${stream_key}/${ID}.mp4`,
      numOfmessages: live.numOfmessages,
      likes: live.likes,
      views: live.views
    }).save();

    if (likes.length > 0) {
      for (const like of likes) {
        await new Like({ streamId: savedLive._id, userId: like.userId }).save();
      }
    }
    await Like.deleteMany({ liveId: live._id });

    await ffmpeg.ffprobe(newPath, async (error, metadata) => {
      if (error) return console.log(error);
      
      const totalSeconds = Math.floor(metadata.format.duration);
      const minutes = Math.floor(totalSeconds / 60) % 60;
      const hours = Math.floor(totalSeconds / 3600);
      const formattedTime = `${hours > 0 ? hours + ':' : ''}${('0' + minutes).slice(-2)}:${('0' + totalSeconds % 60).slice(-2)}`;
      
      await SavedLive.findOneAndUpdate({ streamId: ID }, { duration: formattedTime });

      const command = `ffmpeg -i ${newPath} -preset fast -crf 28 -c:v libx264 -c:a aac -strict -2 -y ${newPath}_copy.mp4 && mv ${newPath}_copy.mp4 ${newPath}`;
      try {
        await exec(command);
      } catch (err) {
        console.log(err);
      }

      videoQueue.add({ streamPath: newPath });
    });

  } catch (err) {
    console.log(err);
  }
});

// Redis video processing queue with 5 concurrent workers
videoQueue.process(5, async (job) => {
  const { streamPath } = job.data;
  try {
    const fileStats = await stat(streamPath);
    const fileSizeInBytes = fileStats.size;
    const fileSizeInGB = fileSizeInBytes / (1024 * 1024 * 1024);

    const command = fileSizeInGB > 5
      ? `ffmpeg -n -loglevel error -i ${streamPath} -vcodec libx264 -crf 28 -preset fast -tune film ${streamPath}_copy.mp4 && mv ${streamPath}_copy.mp4 ${streamPath}`
      : `ffmpeg -n -loglevel error -i ${streamPath} -vcodec libx264 -crf 28 -preset fast -tune film ${streamPath}_copy.mp4 && mv ${streamPath}_copy.mp4 ${streamPath}`;
    
    await exec(command);
  } catch (error) {
    console.log('Error processing video:', error);
    throw new Error(`Video processing failed for job: ${job.id}`);  // Throw error to mark the job as failed
  }
});


// Cron jobs
cron.schedule('* * * * *', () => {
  request.get('http://127.0.0.1:8000/api/streams', (error, response, body) => {
    if (body && body !== 'Unauthorized') {
      const streams = JSON.parse(body);
      if (streams['live']) {
        for (let stream in streams['live']) {
          if (streams['live'].hasOwnProperty(stream)) {
            helpers.generateStreamThumbnail(stream);
          }
        }
      }
    }
  });
}).start();

// Clean up old stream chats every 24 hours
cron.schedule('0 0 * * *', async () => {
  await StreamChat.deleteMany({ "createdAt": { $lt: new Date(Date.now() - 12 * 60 * 60 * 1000) } });
}).start();

nms.run();
