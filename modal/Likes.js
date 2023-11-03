const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const likeSchema = mongoose.Schema({
   userId: {
       type: Schema.Types.ObjectId,
       ref: 'User'
   },
   commentId: {
       type: Schema.Types.ObjectId,
       ref: 'Comment'
   },
   videoId: {
       type: Schema.Types.ObjectId,
       ref: 'Video'
   },
   streamId: {
        type: Schema.Types.ObjectId,
        ref: 'SavedLive'
    },
    liveId: {
        type: Schema.Types.ObjectId,
        ref: 'Live'
    }

}, { timestamps: true })


const Likes = mongoose.model('Likes', likeSchema);

module.exports =  Likes 
