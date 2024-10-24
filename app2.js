require('./connection')
const NodeMediaServer = require('node-media-server');
const Live = require("./modal/Live")
const StreamChat = require("./modal/StreamChat")
const SavedLive = require("./modal/SavedLive")
const SavedStreamChat = require("./modal/SavedStreamChat")
var {nanoid} = require('nanoid');
const Like = require('./modal/Likes')
const shell = require('child_process').execSync ; 
const cron = require('node-cron');
const ffmpeg = require('fluent-ffmpeg');
const helpers = require("./helpers/helper")
const request = require("request");
const { Web3Storage } = require('web3.storage')
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const fs = require('fs');
const { promisify } = require('util');
const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);
const videoQueue = require('./redis')

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
    api : true,
    api_user: `${process.env.ADMIN_USER}`,
    api_pass: `${process.env.ADMIN_PASS}`,
    play: false,
    publish: false,
  },
  trans: {
    ffmpeg: '/usr/bin/ffmpeg',
       tasks: [
        {
          app: 'live',
          hls: true,
          hlsFlags: '[hls_time=2:hls_list_size=3:hls_flags=delete_segments]',
          mp4: true,
          mp4Flags: '[movflags=frag_keyframe+empty_moov]',

          
        }

      
      ]
  },
  relay: {
    ffmpeg: '/usr/bin/ffmpeg',
    tasks: [
      {
        app: 'live',
        mode : 'push',
        edge : 'rtmp://localhost:1935'
        
      },
      {
        app: 'live',
        mode : 'push',
        edge : 'rtmp://localhost:1936'
        
      },
    ]
  }
};

var nms = new NodeMediaServer(config)

nms.on('prePublish', async (id, StreamPath, args) => {
  let stream_key = getStreamKeyFromStreamPath(StreamPath);
  console.log('[NodeEvent on prePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);

  Live.findOne({streamKey: stream_key}, async(err, user) => {
    if (!err) {
        if (!user) {
            let session = nms.getSession(id);
            session.reject();
        } else {
	try {
	    await helpers.generateStreamThumbnail(stream_key);
            const live = await Live.findOneAndUpdate({streamKey: stream_key}, {isActive : true,thumbnail : `https://live.cratch.io/live/${stream_key}/image.png`,views : 0,likes : 0,currentlyWatching : 0,numOfmessages : 0});
	    const chat = await StreamChat.deleteMany({liveId: live._id});
	   await Like.deleteMany({liveId : live?._id});
	}catch(e){
   	    console.log(e);
	}
        }
    }
});
});


nms.on('donePublish', async(id, StreamPath, args) => {
  let stream_key = getStreamKeyFromStreamPath(StreamPath);
  var ID = nanoid();
  const currentPath= `/home/sites/rtmp/media/live/${stream_key}/video.mp4`;
  const newPath= `/home/sites/rtmp/media/live/${stream_key}/${ID}.mp4`;
  shell(`mv ${currentPath} ${newPath}`);
  try {
	const live = await Live.findOneAndUpdate({streamKey: stream_key}, {isActive : false});
	var content = []
	const livechat = await StreamChat.find({liveId : live._id}).then((data) => {
 		if(data && data.length > 0){
                	data.map(chats => {
                                content.push({
                                                creator : chats.creator,
                                                liveId : chats.liveId,
                                                content : chats.content,
						createdAt: chats.createdAt
                                        })
                                })
        }
	}).catch(e =>console.log(e));
	
	const saved = await new SavedStreamChat({streamId : ID, content : content}).save();
	
	const savedLive = await new SavedLive({
		creator : live.creator,
		streamId : ID,
    		title: live.title,
    		description : live.description,
    		category : live.category,
    		thumbnail : live.thumbnail,
    		tags : live.tags,
    		visibility : live.visibility,
    		streamUrl : `https://live.cratch.io/live/${stream_key}/${ID}.mp4`,
    		numOfmessages : live.numOfmessages,
    		likes : live.likes,
    		views : live.views,
	}).save()
	
	const likes = await Like.find({liveId : live?._id});
      if(likes?.length > 0) {
        likes.map(async(like) => {
          await new Like({
            streamId : savedLive?._id,
            userId : like?.userId
          }).save()
        })
      }

	await Like.deleteMany({liveId : live?._id});
	
        await ffmpeg.ffprobe(`./media/live/${stream_key}/${ID}.mp4`, 
		async (error, metadata) =>{
                	const totalSeconds = Math.floor(metadata.format.duration);
                	const minutes = Math.floor(totalSeconds / 60) % 60;
                  const hours = Math.floor(totalSeconds / 3600);

                  const formattedMinutes = ('0' + minutes).slice(-2);
                  const formattedSeconds = ('0' + Math.floor(totalSeconds % 60)).slice(-2);

                  let duration = `${formattedMinutes}:${formattedSeconds}`;

                  if (hours > 0) {
                    duration = `${hours}:${duration}`;
                  }
                	const live =  await SavedLive.findOneAndUpdate({streamId : ID} , {duration : duration});
			const streamPath = `./media/live/${stream_key}/${ID}.mp4`;
    			const command = `ffmpeg -i ${streamPath} -t ${duration} -c:v copy -c:a copy -map_metadata 0 -metadata:s:v:0 rotate=0 -metadata:s:a:0 language=eng -f mp4 ${streamPath}_copy.mp4 && mv ${streamPath}_copy.mp4 ${streamPath}`;
                  
                  	try{
                    		await exec(command);

                  	}catch(e){
                    		console.log(e)
                  	}			
		       videoQueue.add({ streamPath: streamPath });
                });

	}
  catch(e){
	console.log(e);
	}
  console.log('[NodeEvent on donePublish]', `id=${id} StreamPath=${StreamPath} args=${JSON.stringify(args)}`);
});

const getStreamKeyFromStreamPath = (path) => {
  let parts = path.split('/');
  return parts[parts.length - 1];
};


videoQueue.process(async (job) => {
  const { streamPath } = job.data;
  try {
    // Check file size
    const fileStats = await stat(streamPath);
    const fileSizeInBytes = fileStats.size;
    const fileSizeInGB = fileSizeInBytes / (1024 * 1024 * 1024);

    if (fileSizeInGB > 5) {
      // File size is bigger than 5GB, copy only the first 5GB and remove the original file
      const readStream = fs.createReadStream(streamPath);
      const writeStream = fs.createWriteStream(`${streamPath}_copy.mp4`);

      const MAX_SIZE_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
      let totalBytesWritten = 0;

      readStream.on('data', (chunk) => {
        totalBytesWritten += chunk.length;
        if (totalBytesWritten <= MAX_SIZE_BYTES) {
          writeStream.write(chunk);
        } else {
          writeStream.end();
          readStream.destroy();
          console.log('First 5GB of the video content has been saved! 🎥');
        }
      });

      readStream.on('end', () => {
        writeStream.end();
        unlink(streamPath); // Remove the original file
        console.log('The original video file has been removed. First 5GB of the video content has been saved! 🎥');
      });

      readStream.on('error', (error) => {
        console.error('An error occurred while reading the file:', error);
      });

      writeStream.on('finish', async () => {
        try {
          // Rename the copied file to the original file name
          await fs.promises.rename(`${streamPath}_copy.mp4`, streamPath);

          // Proceed with video processing using FFmpeg
          const command = `ffmpeg -n -loglevel error -i ${streamPath} -vcodec libx264 -crf 28 -preset faster -tune film ${streamPath}_copy2.mp4 && mv ${streamPath}_copy2.mp4 ${streamPath}`;
          await exec(command);

          // Continue with your code here...
        } catch (error) {
          console.error('An error occurred while processing the video:', error);
        }
      });

      writeStream.on('error', (error) => {
        console.error('An error occurred while writing the file:', error);
      });
    } else {
      // Proceed with video processing using FFmpeg (file size is smaller than or equal to 5GB)
      const command = `ffmpeg -n -loglevel error -i ${streamPath} -vcodec libx264 -crf 28 -preset faster -tune film ${streamPath}_copy.mp4 && mv ${streamPath}_copy.mp4 ${streamPath}`;
      await exec(command);

      // Continue with your code here...
    }
  } catch (error) {
    // Handle error (e.g., log error, retry job, etc.)
    console.error('Error processing video:', error);
  }
});

nms.run();

function makeStorageClient() {  
  return new Web3Storage({ token: process.env.IPFS_KEY })
}

async function storeVideo(file) {

  // Check file size to ensure it is less than 1gb.

  if ( size / 100024 / 100024 < 1000) {
      try {
          const client = makeStorageClient();
          const newFile = new File([file], file.name, {type: file.type});
          const cid = await client.put([newFile], {
              name: file.name,
          });
          const res = await client.get(cid);
          const videoUrl = `https://${cid}.ipfs.dweb.link/${file.name}`;
          if(res.status === 200) {
              return videoUrl

          }else {
              return ""
          }
      
      }catch(e) {
          return ""
      }
      
  }else {
      return ""
  }
}


cron.schedule('*/10 * * * * *', () => {
  request
       .get('http://127.0.0.1:8000/api/streams', (error, response, body)=> {
         if(body !== undefined && body !== 'undefined' && body !== 'Unauthorized'){
   let streams = JSON.parse(body);
               if (typeof (streams['live'] !== undefined)) {
                   let live_streams = streams['live'];
                   for (let stream in live_streams) {
                         if (!live_streams.hasOwnProperty(stream)) continue;
           console.log(stream)
                           helpers.generateStreamThumbnail(stream);
               }
           }
 }
       });
}).start();


cron.schedule('* * 12 * *', async() => {
  const liveChat = await StreamChat.deleteMany({ "createdAt": { $gt: new Date(Date.now() - 12*60*60 * 1000) } });
}).start();


