const User = require('../../app/models/user')
const Message = require('../../app/models/message')
const Classroom = require('../../app/models/classroom')

const twitter = require('../utilities/twitter.js')()
const visualisation = require('../utilities/visualisation.js')()

module.exports = function (app, passport, io) {
  
  // Get visualisation for given class and duration
  app.get('/v1/messages/vis/:class/:duration',
    async (req, res) => {

      // Get data points
      let vis = await Message.aggregate([{ $match: { course: req.instance, class: req.params.class } }, { $group: { _id: "$segment", count: { $sum: 1 } } }])
      
      // Return formatted visualisation
      res.json({ visualisation: visualisation.format(vis, req.params.duration) })
    })

  // Create message
  app.post('/v1/messages/create',
    async (req, res) => {
        
      let data = {
        _user: req.user,
        _parent: req.body.replyTo,
        course: req.instance,
        class: req.body.currentClass,
        segment: req.body.currentSegmentGroup,
        segmentGroup: req.body.currentSegmentGroup,
        text: req.body.text,
        tweeted: req.body.twitterEnabled,
      }
      
      console.log('User wants to tweet - ', req.body.twitterEnabled ? 'Yes' : 'No')
      console.log('process.env.TWITTER_ENABLED', process.env.TWITTER_ENABLED)
      
      if (req.body.twitterEnabled && process.env.TWITTER_ENABLED) {
        console.log('Attempting to tweet')
        // Post tweet
        let tweet = await twitter.sendTweet(req.user, req.body.text)
        if (tweet && tweet.id_str) {
          console.log('Tweet success!')
          // Add tweet to message data
          data.tweet = tweet
        }
      }
      
      let message = new Message(data)
      message = await message.save()
      message = await Message.findOne({ _id: message._id })
      
      const messageCount = await Message.count({ course: req.instance, class: message.class, segment: message.segment })
      message = message.toObject()
      message.total = messageCount
      
      let response = { message: message }

      // Reply
      if (req.body.replyTo) {
        
        let originalMessage = await Message.findOne({ _id: req.body.replyTo })
        let originalMessageUser = await User.findOne({ _id: originalMessage._user._id })
        
        const handle = `@${originalMessageUser.twitter.username}`
        if (message.text.indexOf(handle) === -1) {
          message = await Message.findByIdAndUpdate(message._id, { text: `${handle} ${message.text}` }, { upsert: true })
        }
        originalMessage = await Message.findOneAndUpdate({ _id: req.body.replyTo }, { $push: { _replies: message._id } })

        message = await Message.findOne({ _id: message._id })
        originalMessage = await Message.findOne({ _id: req.body.replyTo })

        response.originalMessage = originalMessage
      }
      
      // Notify users
      io.to('class').emit('message', message)
      io.to('class').emit('visualisation', 'Updated')
    
      res.json(response)
    }
  )

  // Like message
  app.post('/v1/message/like',
    async (req, res) => {
      let message = await Message.findOne({ _id: req.body.target })
      message._likes.push(req.user)
      message = await message.save()
      message = await Message.findOne({ _id: req.body.target })
      // Notify users
      io.to('class').emit('like', message)

      return res.json(message)
    }
  )

  // Get messages for given class between given start and end segments
  app.get('/v1/messages/:class/:start/:end/:summary?',
    async (req, res) => {
      if (req.params.summary) {
        let messages = []
        const segmentCount = parseInt(req.params.end) - parseInt(req.params.start)
        for (let index = 0; index < segmentCount; index++) {
          const currentSegment = parseInt(req.params.start) + index
          let message = await Message.findOne({ course: req.instance, class: req.params.class, segment: currentSegment }).sort({ created: -1 })
          if (message) {
            const messageCount = await Message.count({ course: req.instance, class: req.params.class, segment: currentSegment })
            message = message.toObject()
            message.total = messageCount
            messages.push(message)
          }
        }
        res.json(messages)
      } else {
        const messages = await Message.find({ $and: [{ course: req.instance, class: req.params.class, _parent: { $exists: false } }, { segment: { $gte: req.params.start } }, { segment: { $lte: req.params.end } }] }).limit(100).sort({ created: 1 })
        res.json(messages)
      }
    })

  // Get own messages
  app.get('/v1/user/messages/:class',
    async (req, res) => {
      const messages = await Message.find({ course: req.instance, _user: req.user, class: req.params.class }).limit(100).sort({ created: -1 })
      res.json(messages)
    })

  // Get teacher messages
  app.get('/v1/teacher/messages/:class',
    async (req, res) => {
      const classroom = await Classroom.findOne({ course: req.instance, _user: req.user, class: req.params.class })
      const messages = await Message.find({ $and: [{ course: req.instance, class: req.params.class }, { _user: { $in: classroom._students } }] }).limit(100).sort({ created: -1 })
      res.json(messages)
    })

  // Get admin messages
  app.get('/v1/admin/messages/:class',
    async (req, res) => {
      const messages = await Message.find({ course: req.instance, class: req.params.class }).limit(100).sort({ created: -1 })
      res.json(messages)
    })
}
